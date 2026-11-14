import type { PDFFont } from 'pdf-lib'
import ArabicReshaper from 'arabic-persian-reshaper'
import bidiFactory from 'bidi-js'

/**
 * GA-Q4-1 — Arabic text preparation for pdf-lib.
 *
 * pdf-lib has NO complex-text layout: it draws the glyphs of the string
 * it is given, left to right, with no shaping and no bidi reordering.
 * Arabic therefore needs three pre-processing steps before drawText:
 *
 *  1. RESHAPE — map each logical Arabic character to its presentation
 *     form (isolated / initial / medial / final, incl. the lam-alef
 *     ligatures U+FEF5-FEFC) via arabic-persian-reshaper 1.0.1 (MIT).
 *     The better-known arabic-reshaper 1.1.0 was REJECTED: it is GPL-3.0.
 *  2. BIDI — reorder the shaped string into visual order with the
 *     Unicode Bidirectional Algorithm via bidi-js 1.1.0 (MIT, UAX-C1
 *     conformant, zero runtime dependencies). This also mirrors paired
 *     punctuation (parentheses) and keeps Latin digit runs left-to-right
 *     inside the right-to-left line.
 *  3. RIGHT-ALIGN — the caller draws the visual line at
 *     x = rightMargin - font.widthOfTextAtSize(visual, size).
 *
 * Word wrap is done on the LOGICAL words (Arabic joining never crosses
 * a space, so shaping per visual line is exact) and each candidate line
 * is measured in its visual form, so the width test is exact.
 *
 * Verified on the VM before this code landed (research/shape-test2):
 * Amiri + this pipeline renders "shwrt Alaqd" correctly joined and
 * right-to-left; the same text drawn unshaped renders disjointed.
 * pdf-lib's fontkit SUBSETTING drops the Arabic presentation-form
 * glyphs (blank render, proven), so the renderer embeds the font with
 * subset:false — see contractSnapshotPdf.ts.
 *
 * FONTKIT QUIRK (found 2026-11-14, live-proof leg): pdf-lib encodes
 * custom-font text through fontkit's layout(), which REVERSES Latin
 * digit runs inside an Arabic-dominant string — drawing the shaped
 * line "… 150 …" whole renders "051" (digit-test.pdf, proven on the
 * VM; the shaped string itself is correct). The renderer therefore
 * never draws a mixed visual line whole: it draws
 * splitVisualLineIntoRuns(visual) — maximal runs of Arabic-script
 * characters vs everything else — each run with its own drawText
 * call, left to right in visual order. A digit run drawn alone
 * renders "150"; a pure Arabic run renders in visual order.
 */

const { ArabicShaper } = ArabicReshaper
const bidi = bidiFactory()

/** Logical Arabic text -> shaped, bidi-reordered visual string. */
export const shapeArabicLine = (logical: string): string => {
  const shaped = ArabicShaper.convertArabic(logical)
  const levels = bidi.getEmbeddingLevels(shaped, 'rtl')
  return bidi.getReorderedString(shaped, levels)
}

/**
 * Is this character part of the Arabic script (for run-splitting)?
 * Digits are NEVER Arabic here — ASCII digits, Arabic-Indic
 * U+0660-U+0669 and Extended Arabic-Indic U+06F0-U+06F9 all count as
 * non-Arabic, so a digit run is always drawn as its own run (see the
 * fontkit quirk above). Presentation forms U+FB50-U+FEFF (the output
 * of the reshaper) count as Arabic, as do the Arabic blocks
 * U+0600-U+06FF, U+0750-U+077F, U+08A0-U+08FF.
 */
export const isArabicScriptChar = (ch: string): boolean => {
  const cp = ch.codePointAt(0) ?? 0
  if (cp >= 0x30 && cp <= 0x39) return false
  if ((cp >= 0x660 && cp <= 0x669) || (cp >= 0x6f0 && cp <= 0x6f9)) return false
  return (cp >= 0x600 && cp <= 0x6ff) || (cp >= 0x750 && cp <= 0x77f) ||
    (cp >= 0x8a0 && cp <= 0x8ff) || (cp >= 0xfb50 && cp <= 0xfeff)
}

/**
 * Split a VISUAL line into maximal runs of Arabic-script characters
 * vs everything else (spaces, punctuation, Latin letters, digits).
 * Runs are returned in visual order, left to right as drawn. Drawing
 * each run with its own drawText call keeps fontkit's layout from
 * re-reversing the digit runs (see the fontkit quirk above); the
 * Arabic runs keep their visual order and the digits keep theirs.
 */
export const splitVisualLineIntoRuns = (visual: string): string[] => {
  const runs: string[] = []
  let current = ''
  let currentArabic: boolean | null = null
  for (const ch of visual) {
    const arabic = isArabicScriptChar(ch)
    if (currentArabic === null || arabic === currentArabic) {
      current += ch
      currentArabic = arabic
    } else {
      runs.push(current)
      current = ch
      currentArabic = arabic
    }
  }
  if (current !== '') {
    runs.push(current)
  }
  return runs
}

/**
 * Inverse of shapeArabicLine for VERIFICATION only (PDF text extraction
 * returns the visual string; reverse it and de-shape to recover the
 * logical text). NOTE: a naive whole-string reverse also reverses Latin
 * digit runs, which bidi keeps left-to-right — so round-trip comparison
 * is exact only for digit-free text; for mixed text compare the
 * extracted visual string against shapeArabicLine(logical) instead.
 */
export const deshapeArabicLine = (visual: string): string =>
  ArabicShaper.convertArabicBack([...visual].reverse().join(''))

const measureVisual = (font: PDFFont, size: number, visual: string): number =>
  font.widthOfTextAtSize(visual, size)

/**
 * Split one logical word that alone exceeds maxWidth into chunks that
 * fit. Chunks are cut on the logical characters and each chunk is
 * measured in its visual form; a cut never splits a lam-alef pair
 * (the reshaper would still shape the halves, but the ligature would
 * be lost — acceptable for an over-long-word fallback, which terms
 * text should never hit).
 */
const splitLongWord = (word: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const chunks: string[] = []
  let current = ''
  for (const ch of word) {
    const candidate = current + ch
    if (measureVisual(font, size, shapeArabicLine(candidate)) <= maxWidth || current === '') {
      current = candidate
    } else {
      chunks.push(current)
      current = ch
    }
  }
  if (current !== '') {
    chunks.push(current)
  }
  return chunks
}

/**
 * Wrap one logical Arabic paragraph into visual lines that fit
 * maxWidth at the given font/size. Returns the lines in VISUAL order
 * (already shaped + bidi-reordered), top to bottom, ready for
 * right-aligned drawText. An empty paragraph yields one empty line
 * (a preserved blank line).
 */
export const wrapArabicParagraph = (paragraph: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const words = paragraph.split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) {
    return ['']
  }
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (measureVisual(font, size, shapeArabicLine(candidate)) <= maxWidth) {
      current = candidate
      continue
    }
    if (current !== '') {
      lines.push(shapeArabicLine(current))
    }
    // The word alone may still be too long: split it.
    if (measureVisual(font, size, shapeArabicLine(word)) <= maxWidth) {
      current = word
    } else {
      const chunks = splitLongWord(word, font, size, maxWidth)
      for (let i = 0; i < chunks.length - 1; i++) {
        lines.push(shapeArabicLine(chunks[i] as string))
      }
      current = chunks[chunks.length - 1] as string
    }
  }
  if (current !== '') {
    lines.push(shapeArabicLine(current))
  }
  return lines
}

/** Wrap one Latin-script paragraph (FR terms, Helvetica) into lines. */
export const wrapLatinParagraph = (paragraph: string, font: PDFFont, size: number, maxWidth: number): string[] => {
  const words = paragraph.split(/\s+/).filter((w) => w !== '')
  if (words.length === 0) {
    return ['']
  }
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      current = candidate
      continue
    }
    if (current !== '') {
      lines.push(current)
    }
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      current = word
    } else {
      // Over-long word: hard-split on characters.
      let chunk = ''
      for (const ch of word) {
        if (font.widthOfTextAtSize(chunk + ch, size) <= maxWidth || chunk === '') {
          chunk += ch
        } else {
          lines.push(chunk)
          chunk = ch
        }
      }
      current = chunk
    }
  }
  if (current !== '') {
    lines.push(current)
  }
  return lines
}
