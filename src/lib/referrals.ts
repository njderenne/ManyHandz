import { Share } from 'react-native'
import { APP_CONFIG } from '@/lib/config/app'
import type { Referral } from '@/lib/db/schema'

/**
 * Referrals — a shareable code + link surfaced via the native share sheet (the user picks SMS,
 * email, WhatsApp, etc.). Codes are server-registered rows in the `referral` table
 * (worker/routes/referrals.ts): `getOrCreateReferralCode()` returns the caller's open single-use
 * code, the shared link lands on app/invite/[code].tsx, and `redeemReferral()` pays both sides
 * in credits.
 *
 * Share an invite the easy way with `shareReferralInvite()` — it registers the code server-side
 * first, so the link is redeemable the moment it's sent.
 *
 * IMPORT DISCIPLINE: this module is covered by the Node unit tier (src/lib/referrals.test.ts —
 * see vitest.config.ts), so its STATIC imports stay framework-free (`react-native` is mocked
 * there; `@/lib/i18n` and `@/lib/api/client` pull untranspiled Expo deps that the Node tier
 * can't parse). The async functions below load those lazily via dynamic import — Metro inlines
 * them on device, and the unit tier never executes them.
 */

/**
 * LEGACY offline derivation (dev screens + unit tests): a stable hash of `seed` → 6-char code.
 * Codes produced here are NOT redeemable unless a matching server row exists — real invites use
 * `getOrCreateReferralCode()` / `shareReferralInvite()` instead.
 */
export function referralCode(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return h.toString(36).toUpperCase().padStart(6, '0').slice(0, 6)
}

/** The invite landing URL — app/invite/[code].tsx on the app's web origin (APP_CONFIG.url). */
export function referralLink(code: string): string {
  return `${APP_CONFIG.url}/invite/${code}`
}

/** Open the native share sheet for an already-known code. Best-effort — never crashes. */
export async function shareReferral(code: string): Promise<void> {
  try {
    const { t } = await import('@/lib/i18n')
    await Share.share({
      message: t('referrals.shareMessage', {
        app: APP_CONFIG.name,
        code,
        link: referralLink(code),
      }),
    })
  } catch {
    // user dismissed / share failed — never crash
  }
}

/**
 * Get-or-create the caller's OPEN invite code on the server (POST /api/referrals). The Worker
 * keeps at most one unredeemed code per user — once it's redeemed, the next call mints a fresh
 * one. Requires a signed-in session; throws ApiError otherwise.
 */
export async function getOrCreateReferralCode(): Promise<string> {
  const { apiFetch } = await import('@/lib/api/client')
  const row = await apiFetch<Referral>('/api/referrals', { method: 'POST' })
  return row.code
}

/** Success payload of POST /api/referrals/redeem — `creditsAwarded` is the redeemer's bonus. */
export type RedeemReferralResult = { ok: true; creditsAwarded: number }

/**
 * Redeem an invite code for the signed-in caller. Failures throw ApiError whose `data.code`
 * carries a machine-readable reason ('not_found' | 'already_redeemed' | 'own_code' |
 * 'already_redeemed_by_you' | 'no_organization' | 'invalid_code') — app/invite/[code].tsx maps
 * these to friendly copy.
 */
export async function redeemReferral(code: string): Promise<RedeemReferralResult> {
  const { apiFetch } = await import('@/lib/api/client')
  return apiFetch<RedeemReferralResult>('/api/referrals/redeem', {
    method: 'POST',
    body: JSON.stringify({ code }),
  })
}

/** The caller's created invites, newest first — redeemedAt/redeemedByUserId = redemption status. */
export async function fetchMyReferrals(): Promise<Referral[]> {
  const { apiFetch } = await import('@/lib/api/client')
  return apiFetch<Referral[]>('/api/referrals/mine')
}

/**
 * One-tap invite: ensure a server-registered code exists, then open the share sheet with its
 * link. Best-effort like shareReferral — a network failure never crashes the calling screen.
 */
export async function shareReferralInvite(): Promise<void> {
  try {
    const code = await getOrCreateReferralCode()
    await shareReferral(code)
  } catch {
    // offline / signed-out — the share sheet simply doesn't open; never crash
  }
}
