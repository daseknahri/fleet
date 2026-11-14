# Amiri Regular — provenance (GA-Q4-1)

- Font: Amiri Regular, Copyright 2010-2022 The Amiri Project Authors
  (https://github.com/aliftype/amiri).
- License: SIL Open Font License 1.1 — see `OFL.txt` in this directory.
- Source file: `Amiri-Regular.ttf` (431,116 bytes), downloaded from the
  google/fonts repository (`ofl/amiri/Amiri-Regular.ttf`).
- SHA-256: `ab391c4147d054c48976e98322ad0eefe1427aa0e0502a12a4c75d80a70cfcd7`.
- The renderer does NOT read this file at runtime. The bytes are embedded
  in `backend/src/utils/arabicFontBase64.ts` (generated from this file with
  `base64 -w100`) because TypeScript does not copy `.ttf` assets into
  `dist`, and the D-14 deploy copies `dist` only. This directory is the
  auditable provenance copy: regenerate the `.ts` from here if the font
  is ever replaced, and update the SHA-256 in both places.
