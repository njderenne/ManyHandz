/**
 * Strip metadata (incl. EXIF GPS) from an uploaded image before it is stored — a privacy guarantee a
 * consumer app can market ("we remove location data from your photos"). Dependency-free so it runs in
 * the Cloudflare Worker runtime (no image library, no native deps).
 *
 * COVERAGE (must stay in sync with ALLOWED_MIME_TYPES in worker/routes/media.ts):
 *   - image/jpeg : every APPn segment (0xFFE0–0xFFEF; EXIF/GPS lives in APP1) + COM comments dropped.
 *   - image/png  : ancillary metadata chunks (eXIf, iTXt, tEXt, zTXt) removed — pure chunk deletion,
 *                  IDAT/critical chunks untouched.
 *   - image/webp : EXIF and XMP chunks removed from the RIFF container (RIFF size fixed) — VP8/VP8L/
 *                  VP8X/ALPH pixel chunks untouched.
 * Each of these is a SAFE, lossless container edit: only metadata sections are removed, pixel data is
 * never re-encoded or otherwise touched. The image bytes are returned unchanged when nothing matched.
 *
 * REJECTED (NOT accepted at upload — see media.ts): HEIC/HEIF/AVIF (ISOBMFF) and GIF. Safe in-place
 * EXIF stripping for those containers is complex/error-prone and a botched strip could corrupt
 * evidence, so we reject them at the door (400) rather than store an un-sanitizable original. This is
 * a web-file-input-only cost: the native picker transcodes HEIC→JPEG (preferredAssetRepresentationMode
 * 'Compatible'), so iPhone camera uploads — the ones that carry GPS — arrive as JPEG and are stripped.
 *
 * The contract: any format the server ACCEPTS is sanitized here; any format that could carry GPS we
 * can't safely sanitize is rejected upstream. So no accepted image keeps its location metadata.
 */
export function stripImageMetadata(bytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return stripJpeg(bytes)
  if (mimeType === 'image/png') return stripPng(bytes)
  if (mimeType === 'image/webp') return stripWebp(bytes)
  // Any other type either carries no GPS EXIF (audio/video/pdf) or is rejected at upload (HEIC/HEIF/
  // AVIF/GIF). Nothing to do here.
  return bytes
}

/**
 * JPEG: drop every APPn segment (EXIF/GPS = APP1) and any COM comment before the first scan (SOS).
 * Only the metadata header segments are removed; the compressed scan and all structural segments
 * (DQT/SOF/DHT/…) are copied verbatim, so pixel data is byte-identical.
 */
function stripJpeg(bytes: Uint8Array): Uint8Array {
  // Must start with SOI (FF D8); if not, it isn't a JPEG we understand — leave it alone.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes

  const keep: Uint8Array[] = [bytes.subarray(0, 2)] // SOI
  let i = 2
  let stripped = false

  while (i + 1 < bytes.length) {
    if (bytes[i] !== 0xff) break // not a marker boundary → malformed; copy remainder defensively below
    const marker = bytes[i + 1]

    if (marker === 0xda) {
      // SOS — start of compressed scan; nothing structured after this. Copy verbatim and finish.
      keep.push(bytes.subarray(i))
      i = bytes.length
      break
    }
    if (marker === 0xd9) {
      // EOI
      keep.push(bytes.subarray(i, i + 2))
      i += 2
      break
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      // RSTn / TEM — standalone markers with no length payload.
      keep.push(bytes.subarray(i, i + 2))
      i += 2
      continue
    }

    if (i + 3 >= bytes.length) break
    const len = (bytes[i + 2] << 8) | bytes[i + 3] // 16-bit big-endian, includes the 2 length bytes
    const segEnd = i + 2 + len
    if (len < 2 || segEnd > bytes.length) break // malformed length → bail, copy remainder defensively

    const isApp = marker >= 0xe0 && marker <= 0xef // APP0..APP15 (APP1 = EXIF/GPS)
    const isComment = marker === 0xfe // COM
    if (isApp || isComment) {
      stripped = true // drop this segment
    } else {
      keep.push(bytes.subarray(i, segEnd)) // structural segment (DQT/SOF/DHT/…) — keep
    }
    i = segEnd
  }

  if (i < bytes.length) keep.push(bytes.subarray(i)) // defensive: copy anything we didn't classify
  if (!stripped) return bytes // nothing removed → return the original buffer unchanged
  return concat(keep)
}

// PNG signature: 8 fixed bytes.
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
// Ancillary chunks that can carry EXIF/GPS or arbitrary text metadata. eXIf is the PNG home for EXIF
// (incl. GPS); the *TXt chunks can embed location strings or copied EXIF. All are non-critical
// (lowercase first letter) — removing them never affects the decoded image.
const PNG_STRIP_TYPES = new Set(['eXIf', 'iTXt', 'tEXt', 'zTXt'])

/**
 * PNG: walk the chunk stream (after the 8-byte signature) and drop the metadata chunks above. Each
 * chunk is [length:4][type:4][data:length][crc:4]; we copy every chunk verbatim except the stripped
 * types. Critical chunks (IHDR/PLTE/IDAT/IEND) are never in the strip set, so pixel data is untouched
 * and existing CRCs stay valid (we don't rewrite any chunk — we only omit whole chunks).
 */
function stripPng(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 8) return bytes
  for (let s = 0; s < 8; s++) if (bytes[s] !== PNG_SIG[s]) return bytes // not a PNG → leave alone

  const keep: Uint8Array[] = [bytes.subarray(0, 8)] // signature
  let i = 8
  let stripped = false

  while (i + 8 <= bytes.length) {
    const len = readUint32BE(bytes, i)
    const chunkEnd = i + 12 + len // 4 len + 4 type + len data + 4 crc
    if (len > bytes.length || chunkEnd > bytes.length) break // malformed → stop; copy remainder below
    const type = String.fromCharCode(bytes[i + 4], bytes[i + 5], bytes[i + 6], bytes[i + 7])

    if (PNG_STRIP_TYPES.has(type)) {
      stripped = true // drop this whole chunk
    } else {
      keep.push(bytes.subarray(i, chunkEnd))
    }
    i = chunkEnd
    if (type === 'IEND') break // end of stream
  }

  if (i < bytes.length) keep.push(bytes.subarray(i)) // defensive: copy any trailing bytes verbatim
  if (!stripped) return bytes
  return concat(keep)
}

const ascii = (s: string) => s.charCodeAt(0)
// RIFF/WEBP fourCCs.
const RIFF = [ascii('R'), ascii('I'), ascii('F'), ascii('F')]
const WEBP = [ascii('W'), ascii('E'), ascii('B'), ascii('P')]
// Chunks that hold metadata in a WebP RIFF container. 'EXIF' carries EXIF/GPS; 'XMP ' carries XMP
// (which can include location). Pixel data lives in VP8 / VP8L / VP8X / ALPH / ANMF / ANIM — never
// these.
const WEBP_STRIP_TYPES = new Set(['EXIF', 'XMP '])

/**
 * WebP: a RIFF container — "RIFF"[size:4]"WEBP" then a sequence of chunks, each [fourCC:4][size:4]
 * [data:size][pad:size&1]. We drop the EXIF/XMP chunks and rewrite the top-level RIFF size to match.
 * Pixel chunks (VP8/VP8L/VP8X/ALPH/…) are copied verbatim, so the decoded image is identical. (The
 * VP8X "has-EXIF/XMP" flag bits become stale, but decoders read the actual chunks, not the flags, so
 * dropping the chunks is sufficient and safe.)
 */
function stripWebp(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 12) return bytes
  for (let s = 0; s < 4; s++) if (bytes[s] !== RIFF[s]) return bytes // not RIFF
  for (let s = 0; s < 4; s++) if (bytes[8 + s] !== WEBP[s]) return bytes // not WEBP

  const header = bytes.subarray(0, 12) // "RIFF"[size]"WEBP"
  const body: Uint8Array[] = []
  let i = 12
  let stripped = false

  while (i + 8 <= bytes.length) {
    const fourCC = String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3])
    const size = readUint32LE(bytes, i + 4)
    const padded = size + (size & 1) // chunks are padded to an even length
    const chunkEnd = i + 8 + padded
    if (chunkEnd > bytes.length) {
      // Malformed/truncated chunk: copy the remainder verbatim and stop (don't risk reshaping it).
      body.push(bytes.subarray(i))
      i = bytes.length
      break
    }
    if (WEBP_STRIP_TYPES.has(fourCC)) {
      stripped = true // drop this chunk (incl. its pad byte)
    } else {
      body.push(bytes.subarray(i, chunkEnd))
    }
    i = chunkEnd
  }
  if (i < bytes.length) body.push(bytes.subarray(i)) // defensive: any trailing bytes

  if (!stripped) return bytes

  // Rewrite the RIFF chunk size = (everything after the 8-byte "RIFF"+size field). That's the 4-byte
  // "WEBP" fourCC plus the surviving body chunks.
  let bodyLen = 0
  for (const b of body) bodyLen += b.length
  const riffSize = 4 + bodyLen
  const out = new Uint8Array(12 + bodyLen)
  out.set(header, 0)
  writeUint32LE(out, 4, riffSize) // overwrite the RIFF size field with the new total
  let off = 12
  for (const b of body) {
    out.set(b, off)
    off += b.length
  }
  return out
}

function concat(parts: Uint8Array[]): Uint8Array {
  let total = 0
  for (const p of parts) total += p.length
  const out = new Uint8Array(total)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function readUint32BE(b: Uint8Array, i: number): number {
  return (b[i] * 0x1000000 + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]) >>> 0
}
function readUint32LE(b: Uint8Array, i: number): number {
  return (b[i] + (b[i + 1] << 8) + (b[i + 2] << 16) + b[i + 3] * 0x1000000) >>> 0
}
function writeUint32LE(b: Uint8Array, i: number, v: number): void {
  b[i] = v & 0xff
  b[i + 1] = (v >>> 8) & 0xff
  b[i + 2] = (v >>> 16) & 0xff
  b[i + 3] = (v >>> 24) & 0xff
}
