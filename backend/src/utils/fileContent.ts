/**
 * Server-side content validation for uploaded files (GA-P2-SEC-FIX-01, finding F-SEC-2).
 *
 * Extension allowlists alone are spoofable: the GA-P2-SECURITY-REVIEW-01 probe
 * showed a plain-text file renamed to `.png` being accepted by the receipt
 * upload (201). This module sniffs the leading magic bytes of an upload
 * buffer and checks that the detected content type matches the type implied
 * by the file extension the endpoint already advertises.
 */

export type DetectedFileType = 'jpeg' | 'png' | 'gif' | 'webp' | 'bmp' | 'tiff' | 'pdf'

const hasPrefix = (buffer: Buffer, bytes: number[], offset = 0): boolean => (
  buffer.length >= offset + bytes.length && bytes.every((byte, index) => buffer[offset + index] === byte)
)

const hasAscii = (buffer: Buffer, text: string, offset = 0): boolean => (
  buffer.length >= offset + text.length && buffer.toString('ascii', offset, offset + text.length) === text
)

// The PDF specification allows the `%PDF-` header to appear within the
// first 1024 bytes of the file. Image signatures are checked at offset 0.
const PDF_HEADER_SEARCH_LIMIT = 1024

const detectPdf = (buffer: Buffer): boolean => {
  const limit = Math.min(buffer.length - 5, PDF_HEADER_SEARCH_LIMIT)
  for (let offset = 0; offset <= limit; offset += 1) {
    if (hasAscii(buffer, '%PDF-', offset)) {
      return true
    }
  }
  return false
}

export const detectFileType = (buffer: Buffer): DetectedFileType | null => {
  if (!buffer || buffer.length === 0) {
    return null
  }
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) {
    return 'jpeg'
  }
  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'png'
  }
  if (hasAscii(buffer, 'GIF87a') || hasAscii(buffer, 'GIF89a')) {
    return 'gif'
  }
  if (hasAscii(buffer, 'RIFF') && hasAscii(buffer, 'WEBP', 8)) {
    return 'webp'
  }
  if (hasAscii(buffer, 'BM')) {
    return 'bmp'
  }
  // TIFF signatures: little-endian, big-endian and BigTIFF
  if (hasPrefix(buffer, [0x49, 0x49, 0x2a, 0x00]) || hasPrefix(buffer, [0x4d, 0x4d, 0x00, 0x2a]) || hasPrefix(buffer, [0x49, 0x49, 0x2b, 0x00])) {
    return 'tiff'
  }
  if (detectPdf(buffer)) {
    return 'pdf'
  }
  return null
}

const EXTENSION_TYPES: Record<string, DetectedFileType> = {
  '.jpg': 'jpeg',
  '.jpeg': 'jpeg',
  '.png': 'png',
  '.gif': 'gif',
  '.webp': 'webp',
  '.bmp': 'bmp',
  '.tiff': 'tiff',
  '.tif': 'tiff',
  '.pdf': 'pdf',
}

/**
 * True when the buffer's detected content type matches the type implied by
 * `extension`. Buffers with no recognized signature and unknown extensions
 * never match.
 */
export const contentMatchesExtension = (buffer: Buffer, extension: string): boolean => {
  const expected = EXTENSION_TYPES[extension.toLowerCase()]
  return !!expected && detectFileType(buffer) === expected
}
