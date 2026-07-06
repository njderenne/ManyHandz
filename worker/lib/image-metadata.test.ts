import { describe, it, expect } from 'vitest'
import { stripImageMetadata } from './image-metadata'

/** Build a tiny but structurally valid JPEG: SOI, optional APP1(EXIF+GPS), DQT (keep), SOS+scan, EOI. */
function jpeg(opts: { withExif?: boolean } = {}): Uint8Array {
  const parts: number[] = [0xff, 0xd8] // SOI
  if (opts.withExif) {
    // APP1 carrying an "Exif\0\0" header + a stand-in for GPS payload bytes.
    const payload = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef] // "Exif\0\0" + GPS-ish
    const len = payload.length + 2
    parts.push(0xff, 0xe1, (len >> 8) & 0xff, len & 0xff, ...payload)
  }
  // DQT (a structural segment that MUST be preserved): FF DB, len=4, 2 data bytes.
  parts.push(0xff, 0xdb, 0x00, 0x04, 0x00, 0x10)
  // SOS (FF DA, len=2, no entries) + one scan byte, then EOI.
  parts.push(0xff, 0xda, 0x00, 0x02, 0x77, 0xff, 0xd9)
  return Uint8Array.from(parts)
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
function u32be(n: number): number[] {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
}
/** A PNG chunk: [len][type][data][crc]. CRC is a fixed stand-in (the stripper never re-validates CRCs). */
function pngChunk(type: string, data: number[]): number[] {
  const t = [type.charCodeAt(0), type.charCodeAt(1), type.charCodeAt(2), type.charCodeAt(3)]
  return [...u32be(data.length), ...t, ...data, 0xaa, 0xbb, 0xcc, 0xdd]
}
/** Build a tiny PNG: signature, IHDR, optional eXIf/tEXt metadata, IDAT (pixel data), IEND. */
function png(opts: { withMeta?: boolean } = {}): Uint8Array {
  const parts: number[] = [...PNG_SIG]
  parts.push(...pngChunk('IHDR', [0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0, 0, 0]))
  if (opts.withMeta) {
    // eXIf chunk carrying "Exif\0\0" + GPS-ish bytes, and a tEXt comment.
    parts.push(...pngChunk('eXIf', [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]))
    parts.push(...pngChunk('tEXt', [0x47, 0x50, 0x53])) // "GPS"
  }
  parts.push(...pngChunk('IDAT', [0x12, 0x34, 0x56, 0x78])) // pixel data — MUST survive
  parts.push(...pngChunk('IEND', []))
  return Uint8Array.from(parts)
}

const ascii4 = (s: string) => [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]
function u32le(n: number): number[] {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}
/** A WebP RIFF chunk: [fourCC][size][data][pad?]. */
function webpChunk(fourCC: string, data: number[]): number[] {
  const pad = data.length & 1 ? [0x00] : []
  return [...ascii4(fourCC), ...u32le(data.length), ...data, ...pad]
}
/** Build a tiny WebP (RIFF/WEBP): VP8L pixel chunk + optional EXIF/XMP metadata. RIFF size is fixed up. */
function webp(opts: { withMeta?: boolean } = {}): Uint8Array {
  const body: number[] = []
  body.push(...webpChunk('VP8L', [0x2f, 0x00, 0x11, 0x22, 0x33])) // pixel data — MUST survive
  if (opts.withMeta) {
    body.push(...webpChunk('EXIF', [0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad, 0xbe, 0xef]))
    body.push(...webpChunk('XMP ', [0x3c, 0x78, 0x3a])) // "<x:" XMP-ish
  }
  const riffSize = 4 + body.length // "WEBP" + body
  return Uint8Array.from([...ascii4('RIFF'), ...u32le(riffSize), ...ascii4('WEBP'), ...body])
}

describe('stripImageMetadata — JPEG', () => {
  it('removes the APP1/EXIF (GPS) segment from a JPEG', () => {
    const withExif = jpeg({ withExif: true })
    const out = stripImageMetadata(withExif, 'image/jpeg')
    // The "Exif" marker bytes must be gone.
    expect(Array.from(out)).not.toContain(0xde) // the GPS-ish payload byte
    const hasExifHeader = Buffer.from(out).includes(Buffer.from('Exif'))
    expect(hasExifHeader).toBe(false)
    // Output is smaller (APP1 dropped) and still a valid JPEG (SOI…EOI).
    expect(out.length).toBeLessThan(withExif.length)
    expect(out[0]).toBe(0xff)
    expect(out[1]).toBe(0xd8)
    expect(out[out.length - 2]).toBe(0xff)
    expect(out[out.length - 1]).toBe(0xd9)
    // The structural DQT (FF DB) survives.
    let foundDqt = false
    for (let i = 0; i < out.length - 1; i++) if (out[i] === 0xff && out[i + 1] === 0xdb) foundDqt = true
    expect(foundDqt).toBe(true)
  })

  it('leaves a JPEG with no metadata unchanged (same buffer)', () => {
    const clean = jpeg()
    const out = stripImageMetadata(clean, 'image/jpeg')
    expect(out).toBe(clean) // returns the original reference when nothing was stripped
  })

  it('ignores non-JPEG-looking bytes even if labeled jpeg', () => {
    const notJpeg = Uint8Array.from([0x00, 0x01, 0x02, 0x03])
    expect(stripImageMetadata(notJpeg, 'image/jpeg')).toBe(notJpeg)
  })
})

describe('stripImageMetadata — PNG', () => {
  it('removes eXIf/tEXt metadata chunks but keeps IDAT pixel data + IEND', () => {
    const withMeta = png({ withMeta: true })
    const out = stripImageMetadata(withMeta, 'image/png')
    // EXIF/text metadata is gone.
    expect(Buffer.from(out).includes(Buffer.from('eXIf'))).toBe(false)
    expect(Buffer.from(out).includes(Buffer.from('tEXt'))).toBe(false)
    expect(Array.from(out)).not.toContain(0xde) // the GPS-ish payload byte
    // Pixel data and structure survive untouched.
    expect(Buffer.from(out).includes(Buffer.from('IDAT'))).toBe(true)
    expect(Buffer.from(out).includes(Buffer.from('IHDR'))).toBe(true)
    expect(Buffer.from(out).includes(Buffer.from('IEND'))).toBe(true)
    // The 8-byte PNG signature is intact.
    expect(Array.from(out.subarray(0, 8))).toEqual(PNG_SIG)
    // The IDAT chunk's data bytes are byte-identical (pixel data never touched).
    expect(Buffer.from(out).includes(Buffer.from([0x12, 0x34, 0x56, 0x78]))).toBe(true)
    expect(out.length).toBeLessThan(withMeta.length)
  })

  it('leaves a PNG with no metadata unchanged (same buffer)', () => {
    const clean = png()
    const out = stripImageMetadata(clean, 'image/png')
    expect(out).toBe(clean)
  })

  it('ignores non-PNG bytes labeled png', () => {
    const notPng = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08])
    expect(stripImageMetadata(notPng, 'image/png')).toBe(notPng)
  })
})

describe('stripImageMetadata — WebP', () => {
  it('removes EXIF/XMP chunks, keeps the VP8L pixel chunk, and fixes the RIFF size', () => {
    const withMeta = webp({ withMeta: true })
    const out = stripImageMetadata(withMeta, 'image/webp')
    // Metadata chunks are gone.
    expect(Buffer.from(out).includes(Buffer.from('EXIF'))).toBe(false)
    expect(Buffer.from(out).includes(Buffer.from('XMP '))).toBe(false)
    expect(Array.from(out)).not.toContain(0xde) // GPS-ish payload byte
    // Pixel chunk survives, including its data bytes.
    expect(Buffer.from(out).includes(Buffer.from('VP8L'))).toBe(true)
    expect(Buffer.from(out).includes(Buffer.from([0x2f, 0x00, 0x11, 0x22, 0x33]))).toBe(true)
    // RIFF/WEBP header intact.
    expect(Buffer.from(out.subarray(0, 4)).toString('ascii')).toBe('RIFF')
    expect(Buffer.from(out.subarray(8, 12)).toString('ascii')).toBe('WEBP')
    // The RIFF size field (LE @ offset 4) equals the actual remaining bytes after offset 8.
    const declared = out[4] + (out[5] << 8) + (out[6] << 16) + out[7] * 0x1000000
    expect(declared).toBe(out.length - 8)
    expect(out.length).toBeLessThan(withMeta.length)
  })

  it('leaves a WebP with no metadata unchanged (same buffer)', () => {
    const clean = webp()
    const out = stripImageMetadata(clean, 'image/webp')
    expect(out).toBe(clean)
  })

  it('ignores non-WebP bytes labeled webp', () => {
    const notWebp = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b])
    expect(stripImageMetadata(notWebp, 'image/webp')).toBe(notWebp)
  })
})

describe('stripImageMetadata — other types', () => {
  it('passes non-image bytes through untouched', () => {
    const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d]) // "%PDF-"
    expect(stripImageMetadata(pdf, 'application/pdf')).toBe(pdf)
  })

  // HEIC/HEIF/AVIF/GIF are rejected at the media-route allow-list (not accepted), so they never reach
  // the stripper. If one somehow did, it passes through unchanged — which is exactly why the route
  // must reject them rather than rely on this function.
  it('passes rejected formats through untouched (route is responsible for rejecting them)', () => {
    const heic = Uint8Array.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70]) // …ftyp box-ish
    expect(stripImageMetadata(heic, 'image/heic')).toBe(heic)
  })
})
