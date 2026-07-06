import { describe, it, expect } from 'vitest'
import {
  aadFor,
  encryptTokenBlob,
  decryptTokenBlob,
  ensureFreshToken,
  type OAuthTokens,
  type ProviderConfig,
  type TokenBinding,
} from './providers'
import type { Env } from '../env'

/** Minimal Env — the token envelope reads only TOKEN_CIPHER_KEY / BETTER_AUTH_SECRET. */
const env = { TOKEN_CIPHER_KEY: 'test-cipher-key-32-bytes-of-entropy!!' } as unknown as Env

const USER = 'user_abc123'
const TOKENS: OAuthTokens = {
  access_token: 'at_secret_value',
  refresh_token: 'rt_secret_value',
  expires_in: 3600,
  scope: 'read',
}

describe('aadFor — the binding → AAD mapping', () => {
  it('user binding maps to the bare userId (byte-compat with pre-binding rows)', () => {
    expect(aadFor({ userId: USER })).toBe(USER)
  })

  it('org binding maps to the cadio shape org:<orgId>:provider:<app>:<channel>', () => {
    expect(aadFor({ orgId: 'org_1', app: 'myapp', channel: 'google_ads' })).toBe(
      'org:org_1:provider:myapp:google_ads',
    )
  })
})

describe('token envelope — backward compat (no binding param)', () => {
  it('round-trips with NO binding param, exactly like the pre-binding code', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS)
    const back = await decryptTokenBlob(env, USER, ciphertext)
    expect(back).toEqual(TOKENS)
  })

  it('a no-param ciphertext decrypts under an explicit { userId } binding (same AAD)', async () => {
    // Existing rows were encrypted with AAD=userId; a caller upgraded to pass the binding
    // explicitly must keep decrypting them — the two spellings are the same binding.
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS)
    const back = await decryptTokenBlob(env, USER, ciphertext, { userId: USER })
    expect(back).toEqual(TOKENS)
  })

  it('a ciphertext copied onto another user fails to decrypt (the original tamper guarantee)', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS)
    await expect(decryptTokenBlob(env, 'user_other', ciphertext)).rejects.toThrow()
  })
})

describe('token envelope — org binding', () => {
  const ORG: TokenBinding = { orgId: 'org_1', app: 'myapp', channel: 'google_ads' }

  it('round-trips under an org binding', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS, ORG)
    const back = await decryptTokenBlob(env, USER, ciphertext, ORG)
    expect(back).toEqual(TOKENS)
  })

  it('cross-binding decrypt FAILS: org-bound ciphertext will not open under the user binding', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS, ORG)
    await expect(decryptTokenBlob(env, USER, ciphertext)).rejects.toThrow()
    await expect(decryptTokenBlob(env, USER, ciphertext, { userId: USER })).rejects.toThrow()
  })

  it('cross-binding decrypt FAILS: user-bound ciphertext will not open under an org binding', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS)
    await expect(decryptTokenBlob(env, USER, ciphertext, ORG)).rejects.toThrow()
  })

  it('a ciphertext moved across orgs / channels fails to decrypt (tamper test)', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS, ORG)
    await expect(
      decryptTokenBlob(env, USER, ciphertext, { orgId: 'org_2', app: 'myapp', channel: 'google_ads' }),
    ).rejects.toThrow()
    await expect(
      decryptTokenBlob(env, USER, ciphertext, { orgId: 'org_1', app: 'myapp', channel: 'meta_ads' }),
    ).rejects.toThrow()
  })
})

describe('ensureFreshToken — binding threads through decrypt AND re-encrypt', () => {
  const cfg = { provider: 'fake', clientId: 'id', clientSecret: 'secret' } as ProviderConfig
  const ORG: TokenBinding = { orgId: 'org_1', app: 'myapp', channel: 'google_ads' }

  it('a non-expired org-bound row decrypts with its binding and returns without refresh', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS, ORG)
    const tokens = await ensureFreshToken({
      env,
      cfg,
      userId: USER,
      ciphertext,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1h out — no refresh path, no fetch
      binding: ORG,
      persist: async () => {
        throw new Error('should not persist when no refresh is needed')
      },
    })
    expect(tokens).toEqual(TOKENS)
  })

  it('an org-bound row read WITHOUT its binding throws (no silent fallback)', async () => {
    const ciphertext = await encryptTokenBlob(env, USER, TOKENS, ORG)
    await expect(
      ensureFreshToken({
        env,
        cfg,
        userId: USER,
        ciphertext,
        expiresAt: null,
        persist: async () => {},
      }),
    ).rejects.toThrow()
  })
})
