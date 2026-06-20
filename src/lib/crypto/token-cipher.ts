/**
 * Token cipher — AES-256-GCM envelope encryption for per-tenant secrets at rest (third-party API
 * tokens, OAuth refresh tokens, webhook signing keys). WebCrypto only, so it runs identically in
 * Cloudflare Workers, Node (tests), and the browser.
 *
 * Tenant binding: the organization id goes in as ADDITIONAL AUTHENTICATED DATA (AAD), so a
 * ciphertext copied onto another org's row fails to decrypt — the data layer can't be tricked
 * into handing org A's token to org B, even with raw DB access.
 *
 * Envelope format (opaque to callers, safe in a text column): `v1.<iv>.<ciphertext>` (base64url).
 *
 * Key: a high-entropy secret from the environment (e.g. `openssl rand -base64 32` →
 * `wrangler secret put TOKEN_CIPHER_KEY`). It is hashed to exactly 256 bits on import, never
 * stored. Rotating it requires re-encrypting stored tokens (the version prefix exists so a
 * future v2 can run both keys side by side during migration).
 */

const VERSION = 'v1'
const IV_BYTES = 12 // 96-bit nonce, the GCM standard

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function toBase64Url(bytes: Uint8Array): string {
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replaceAll('-', '+').replaceAll('_', '/'))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

/** Import the environment secret as an AES-256-GCM key (SHA-256 → exactly 32 bytes). */
export async function importTokenKey(secret: string): Promise<CryptoKey> {
  if (!secret) throw new Error('token cipher: secret is required')
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

/**
 * Encrypt a token for one tenant. `aad` is the binding context — pass the organization id
 * (or `org:<id>:provider:<name>` for finer scoping); decryption requires the exact same value.
 */
export async function encryptToken(key: CryptoKey, plaintext: string, aad: string): Promise<string> {
  if (!aad) throw new Error('token cipher: aad (tenant binding) is required')
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(aad) },
    key,
    encoder.encode(plaintext),
  )
  return `${VERSION}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
}

/**
 * Decrypt an envelope produced by `encryptToken`. Throws on a wrong key, wrong/missing AAD,
 * tampered ciphertext, or malformed envelope — never returns garbage.
 */
export async function decryptToken(key: CryptoKey, envelope: string, aad: string): Promise<string> {
  if (!aad) throw new Error('token cipher: aad (tenant binding) is required')
  const parts = envelope.split('.')
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error(`token cipher: malformed or unsupported envelope (expected ${VERSION}.<iv>.<ct>)`)
  }
  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64Url(parts[1]), additionalData: encoder.encode(aad) },
      key,
      fromBase64Url(parts[2]),
    )
  } catch {
    // WebCrypto throws an opaque OperationError on any auth failure — rethrow with context.
    throw new Error('token cipher: decryption failed (wrong key, wrong tenant binding, or tampered data)')
  }
  return decoder.decode(plaintext)
}
