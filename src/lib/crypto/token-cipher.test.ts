import { describe, it, expect } from 'vitest'
import { importTokenKey, encryptToken, decryptToken } from './token-cipher'

const SECRET = 'test-secret-high-entropy-please'
const ORG_A = 'org_aaaaaaaa'
const ORG_B = 'org_bbbbbbbb'

describe('token-cipher', () => {
  it('round-trips a token for the same tenant', async () => {
    const key = await importTokenKey(SECRET)
    const envelope = await encryptToken(key, 'sk-live-12345', ORG_A)
    expect(envelope).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    await expect(decryptToken(key, envelope, ORG_A)).resolves.toBe('sk-live-12345')
  })

  it('round-trips unicode plaintext', async () => {
    const key = await importTokenKey(SECRET)
    const envelope = await encryptToken(key, 'pässwörd-Δοκιμή-🔐', ORG_A)
    await expect(decryptToken(key, envelope, ORG_A)).resolves.toBe('pässwörd-Δοκιμή-🔐')
  })

  it('refuses to decrypt under a different tenant binding (AAD)', async () => {
    const key = await importTokenKey(SECRET)
    const envelope = await encryptToken(key, 'sk-live-12345', ORG_A)
    await expect(decryptToken(key, envelope, ORG_B)).rejects.toThrow(/decryption failed/)
  })

  it('refuses to decrypt with a different key', async () => {
    const keyA = await importTokenKey(SECRET)
    const keyB = await importTokenKey('a-completely-different-secret')
    const envelope = await encryptToken(keyA, 'sk-live-12345', ORG_A)
    await expect(decryptToken(keyB, envelope, ORG_A)).rejects.toThrow(/decryption failed/)
  })

  it('refuses tampered ciphertext', async () => {
    const key = await importTokenKey(SECRET)
    const envelope = await encryptToken(key, 'sk-live-12345', ORG_A)
    const [v, iv, ct] = envelope.split('.')
    // Flip the FIRST ciphertext character — its bits are always significant (the last char's
    // low bits can be base64 padding, where a flip decodes to the same bytes).
    const tampered = `${v}.${iv}.${ct[0] === 'A' ? 'B' : 'A'}${ct.slice(1)}`
    await expect(decryptToken(key, tampered, ORG_A)).rejects.toThrow(/decryption failed/)
  })

  it('rejects malformed envelopes with a clear error', async () => {
    const key = await importTokenKey(SECRET)
    await expect(decryptToken(key, 'not-an-envelope', ORG_A)).rejects.toThrow(/malformed/)
    await expect(decryptToken(key, 'v9.abc.def', ORG_A)).rejects.toThrow(/malformed/)
  })

  it('uses a fresh IV per encryption (same input → different envelopes)', async () => {
    const key = await importTokenKey(SECRET)
    const a = await encryptToken(key, 'same-token', ORG_A)
    const b = await encryptToken(key, 'same-token', ORG_A)
    expect(a).not.toBe(b)
  })

  it('requires a secret and an aad', async () => {
    await expect(importTokenKey('')).rejects.toThrow(/secret is required/)
    const key = await importTokenKey(SECRET)
    await expect(encryptToken(key, 'x', '')).rejects.toThrow(/aad/)
    await expect(decryptToken(key, 'v1.a.b', '')).rejects.toThrow(/aad/)
  })
})
