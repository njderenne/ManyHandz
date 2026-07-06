/**
 * Tamper-evident integrity stamp — the GENERIC capability behind verifiable document/report export.
 * Given a content payload, `stampContent` produces a SHA-256 hash of its CANONICAL JSON plus a short,
 * human-legible verification code. A recipient who re-hashes the same content reproduces the same hash
 * only if nothing was altered; the verification code is the at-a-glance label printed on every page of
 * the exported PDF (see src/lib/pdf/html-report.ts).
 *
 * Runs on the Cloudflare Workers runtime, which has Web Crypto but NOT node:crypto — so hashing and
 * randomness go through `crypto.subtle` / `crypto.getRandomValues`.
 *
 * Canonical hashing contract — the WHOLE point of this module:
 *   - The payload is serialized with object keys SORTED recursively, so two objects with the same
 *     content but different key order hash identically.
 *   - Hash only the CONTENT being attested. Keep VOLATILE fields (e.g. `generatedAt`, a render
 *     timestamp, a request id) OUTSIDE the hashed payload — they change every render and would make
 *     the hash unreproducible. Stamp the content, then attach volatile metadata alongside the stamp.
 */

/** Crockford-ish alphabet (no I/L/O/U) for a human-legible, unambiguous verification code. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

/** SHA-256 of a string, lowercase hex. Web Crypto (node:crypto isn't on Workers). */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A random 16-char verification code, grouped `XXXX-XXXX-XXXX-XXXX` for legibility. */
export function authCode16(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < 16; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}

/**
 * Stable-key JSON: serialize with object keys sorted recursively so logically-equal payloads always
 * produce the same string (and therefore the same hash) regardless of key insertion order. Arrays
 * keep their order (it's meaningful); primitives serialize as-is.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  // Non-plain objects must serialize to the SAME form JSON.stringify produces on the wire, or the
  // stamp can never be reproduced from the HTTP payload. A Date stringifies via toJSON() to its ISO
  // string; the generic object branch below would instead see Object.keys(date) === [] and collapse
  // it to {}, dropping all timestamp content from the hash. Handle it FIRST.
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(obj).sort()) out[key] = sortKeys(obj[key])
    return out
  }
  return value
}

export type IntegrityStamp = {
  algorithm: 'SHA-256'
  /** SHA-256 hex of the canonical JSON of `payload`. */
  hash: string
  /** Random human-legible code (NOT derived from content) printed for at-a-glance reference. */
  verificationCode: string
}

/**
 * Seal a CONTENT payload with a SHA-256 hash (over its canonical JSON) and a random verification code.
 * Pass ONLY the content being attested — keep volatile fields (generatedAt, request id, etc.) out of
 * `payload` and attach them next to the returned stamp instead.
 */
export async function stampContent(payload: unknown): Promise<IntegrityStamp> {
  const hash = await sha256Hex(canonicalJson(payload))
  return { algorithm: 'SHA-256', hash, verificationCode: authCode16() }
}
