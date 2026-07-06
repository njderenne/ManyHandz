/**
 * Constant-time string comparison for shared-secret checks (Bearer tokens, webhook secrets that
 * arrive as headers). JavaScript `===`/`!==` short-circuits on the first differing byte, which
 * leaks a timing signal about how much of the secret matched. Workers ships the non-standard
 * `crypto.subtle.timingSafeEqual` (synchronous, unlike the rest of SubtleCrypto) precisely for
 * this — it requires equal byte lengths, so the length check happens first (length is already
 * public knowledge for a `Bearer <token>` header format; it leaks nothing new).
 *
 * Network jitter makes remote timing attacks on Workers largely impractical, so this is hygiene,
 * not a patched exploit — but the two gates that use it (worker/routes/admin-config.ts, the
 * env-key matrix; worker/middleware/dev-auth.ts, the production dev surface) both protect
 * studio-wide credentials, and the constant-time form costs nothing.
 */
type MaybeTimingSafeSubtle = SubtleCrypto & {
  timingSafeEqual?: (a: ArrayBufferView, b: ArrayBufferView) => boolean
}

export function timingSafeEqualStr(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.byteLength !== bb.byteLength) return false
  // Workers runtime: the native primitive. Feature-detected because vitest runs this module on
  // Node, where the extension doesn't exist (it's a Cloudflare addition, not Web Crypto).
  const subtle = crypto.subtle as MaybeTimingSafeSubtle
  if (typeof subtle.timingSafeEqual === 'function') return subtle.timingSafeEqual(ab, bb)
  // Portable constant-time fallback: XOR-accumulate every byte — no early exit, so comparison
  // time is independent of where (or whether) the inputs differ.
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i]
  return diff === 0
}
