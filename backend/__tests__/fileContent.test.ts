import { contentMatchesExtension, detectFileType } from '../src/utils/fileContent'

const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01])
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52])
const gif87 = Buffer.concat([Buffer.from('GIF87a'), Buffer.from([0x01, 0x00, 0x01, 0x00])])
const gif89 = Buffer.concat([Buffer.from('GIF89a'), Buffer.from([0x01, 0x00, 0x01, 0x00])])
const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0x1a, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ')])
const bmp = Buffer.concat([Buffer.from('BM'), Buffer.from([0x3a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])])
const tiffLe = Buffer.from([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00])
const tiffBe = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08])
const pdf = Buffer.from('%PDF-1.7\n')
const pdfWithLeadingJunk = Buffer.concat([Buffer.alloc(512, 0x20), Buffer.from('%PDF-1.4\n')])
const text = Buffer.from('plain text payload, definitely not an image or a PDF document')

describe('detectFileType (GA-P2-SEC-FIX-01)', () => {
  it('detects each supported signature', () => {
    expect(detectFileType(jpeg)).toBe('jpeg')
    expect(detectFileType(png)).toBe('png')
    expect(detectFileType(gif87)).toBe('gif')
    expect(detectFileType(gif89)).toBe('gif')
    expect(detectFileType(webp)).toBe('webp')
    expect(detectFileType(bmp)).toBe('bmp')
    expect(detectFileType(tiffLe)).toBe('tiff')
    expect(detectFileType(tiffBe)).toBe('tiff')
    expect(detectFileType(pdf)).toBe('pdf')
    expect(detectFileType(pdfWithLeadingJunk)).toBe('pdf')
  })

  it('returns null for unrecognized or empty content', () => {
    expect(detectFileType(text)).toBeNull()
    expect(detectFileType(Buffer.alloc(0))).toBeNull()
    expect(detectFileType(Buffer.from([0x89, 0x50]))).toBeNull()
  })
})

describe('contentMatchesExtension (GA-P2-SEC-FIX-01)', () => {
  it('accepts content that matches the extension', () => {
    expect(contentMatchesExtension(jpeg, '.jpg')).toBe(true)
    expect(contentMatchesExtension(jpeg, '.jpeg')).toBe(true)
    expect(contentMatchesExtension(png, '.png')).toBe(true)
    expect(contentMatchesExtension(png, '.PNG')).toBe(true)
    expect(contentMatchesExtension(gif89, '.gif')).toBe(true)
    expect(contentMatchesExtension(webp, '.webp')).toBe(true)
    expect(contentMatchesExtension(bmp, '.bmp')).toBe(true)
    expect(contentMatchesExtension(tiffLe, '.tiff')).toBe(true)
    expect(contentMatchesExtension(pdf, '.pdf')).toBe(true)
  })

  it('rejects spoofed or mismatched content (the F-SEC-2 probe case)', () => {
    expect(contentMatchesExtension(text, '.png')).toBe(false)
    expect(contentMatchesExtension(text, '.pdf')).toBe(false)
    expect(contentMatchesExtension(text, '.jpg')).toBe(false)
    expect(contentMatchesExtension(png, '.jpg')).toBe(false)
    expect(contentMatchesExtension(jpeg, '.png')).toBe(false)
    expect(contentMatchesExtension(pdf, '.png')).toBe(false)
  })

  it('rejects unknown extensions and empty buffers', () => {
    expect(contentMatchesExtension(png, '.exe')).toBe(false)
    expect(contentMatchesExtension(png, '')).toBe(false)
    expect(contentMatchesExtension(Buffer.alloc(0), '.png')).toBe(false)
  })
})
