import type { VerifyVerdict } from './verify-photos'

/**
 * Signed verdict token — lets the photo-check ("preview") and the actual completion ("commit") be two
 * steps WITHOUT re-running the model on commit (consistent + half the cost) and WITHOUT trusting the
 * client (a kid can't fake an approval). The preview signs the verdict it just computed; the commit
 * verifies the signature, that it hasn't expired, and that it's for THIS assignment + after photo,
 * then applies the exact verdict the user saw. HMAC-SHA256 over the studio's Better-Auth secret.
 */
export type VerdictToken = {
  assignmentId: string
  afterPhotoMediaId: string
  verdict: VerifyVerdict
  /** Epoch ms expiry — short-lived; the user reviews + submits within minutes. */
  exp: number
}

const b64url = {
  encode(bytes: Uint8Array): string {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  },
  decode(s: string): Uint8Array {
    return Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  },
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

/** Sign a verdict for this assignment + after photo. Default TTL 15 min — plenty to review and submit. */
export async function signVerdict(
  secret: string,
  data: Omit<VerdictToken, 'exp'>,
  ttlMs = 15 * 60 * 1000,
): Promise<string> {
  const payload: VerdictToken = { ...data, exp: Date.now() + ttlMs }
  const body = b64url.encode(new TextEncoder().encode(JSON.stringify(payload)))
  const sig = await crypto.subtle.sign('HMAC', await key(secret), new TextEncoder().encode(body))
  return `${body}.${b64url.encode(new Uint8Array(sig))}`
}

/** Verify + decode a token. Returns null on a bad signature, malformed body, or expiry. */
export async function verifyVerdictToken(secret: string, token: string): Promise<VerdictToken | null> {
  const [body, sig] = token.split('.')
  if (!body || !sig) return null
  const ok = await crypto.subtle.verify('HMAC', await key(secret), b64url.decode(sig), new TextEncoder().encode(body))
  if (!ok) return null
  try {
    const payload = JSON.parse(new TextDecoder().decode(b64url.decode(body))) as VerdictToken
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}
