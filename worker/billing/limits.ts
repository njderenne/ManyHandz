import type { Context } from 'hono'
import { and, eq, isNull, ne, sql } from 'drizzle-orm'
import { APIError } from 'better-auth/api'
import { schema, type DB } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { PERSONAL_KIND, roleForJoin } from '@/lib/config/roles'
import { limitFor } from '@/lib/config/monetization'
import { requireTier } from '../entitlements'

/**
 * Billing enforcement pack — the canonical 402 contract + (A1) the three cap helpers.
 *
 * ── STAGE-0 SEED (2026-07-05 harvest, STAGE0_SPEC §6.5) ──────────────────────────────────────
 * The error-contract block below (BillingErrorCode / BillingDenied / BillingCheck +
 * billingError) is orchestrator-seeded and FROZEN — every cluster imports this envelope
 * (subjects cap gate, media quota, tenant caps, client 402 routing) and no cluster reshapes it.
 * A1 (billing-merge) owns ALL logic in this file and EXTENDS it with the cap helpers of
 * BILLING_SPEC §8.1: `checkEntityCap`, `checkStorageQuota`, `historyCutoff`, plus the auth-hook
 * contracts `membershipCapFor` and `assertTenantCapacity`.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 */

/** EVERY billing denial uses this envelope so the client can route it (BILLING §9.4). Ratified
 *  code list — includes keepsey's exact live 'storage_quota_exceeded' string: */
export type BillingErrorCode =
  | 'tier_required'            // requireTier / requireFeature miss
  | 'entity_cap_exceeded'      // free-tier row cap (pets, plants, campaigns, …)
  | 'member_cap_exceeded'      // membershipLimit (surfaced via Better-Auth error mapping)
  | 'tenant_limit_exceeded'    // beforeCreateOrganization
  | 'storage_quota_exceeded'   // media bytes
  | 'ai_quota_exceeded'        // checkAiQuota miss
  | 'billing_not_configured'   // keys absent (honest degradation — HTTP 503, not 402)

export type BillingDenied = {
  ok: false
  error: string                        // human copy, server-authored
  code: BillingErrorCode
  limit?: number
  used?: number
  upgradeTier?: 'STANDARD' | 'PREMIUM'
}

export type BillingCheck = { ok: true } | BillingDenied

/**
 * Sugar: `const gate = await checkEntityCap(…); if (!gate.ok) return billingError(c, gate)` → 402.
 * 'billing_not_configured' is the one non-402: keys absent is an OPERATOR problem, not a payment
 * prompt, so it maps to 503 (honest degradation — never sell an upgrade that can't be bought).
 */
export function billingError(c: Context, denied: BillingDenied): Response {
  return c.json(denied, denied.code === 'billing_not_configured' ? 503 : 402)
}

// ─── Cap helpers (A1 — BILLING_SPEC §8.1) ──────────────────────────────────────────────────────
// Every helper is a config-driven NO-OP when its monetization.limits key is absent, so a minted
// app that never fills `limits` pays zero cost and blocks nothing. The count/entitlement order is
// deliberate (keepsey doctrine): the cheap count check runs first, and the entitlement read runs
// ONLY when the org is over the cap — paid/trialing orgs sail past with one extra indexed select.

/**
 * Free-tier entity cap (pets, plants, campaigns, …). `key` indexes monetization.limits;
 * `currentCount` is the CALLER's org-scoped count — the route owns its query so this helper
 * stays table-agnostic. Orgs at/above `liftTier` (default: the trial tier, which is what erases
 * keepsey's PREMIUM-keyed fork — that's just trialTier:'PREMIUM' config) are never capped.
 * Call BEFORE the INSERT:
 *
 *   const gate = await checkEntityCap(db, orgId, 'pets', count)
 *   if (!gate.ok) return billingError(c, gate)
 */
export async function checkEntityCap(
  db: DB,
  orgId: string,
  key: string,
  currentCount: number,
  liftTier?: 'STANDARD' | 'PREMIUM',
): Promise<BillingCheck> {
  const cap = limitFor(key)
  if (cap === undefined) return { ok: true }
  if (currentCount < cap) return { ok: true }
  const lift = liftTier ?? APP_CONFIG.subscription.trialTier
  const gate = await requireTier(db, orgId, lift)
  if (gate.ok) return { ok: true }
  return {
    ok: false,
    error: `The free plan includes ${cap} ${key}. Upgrade to ${APP_CONFIG.monetization.tiers[lift].label} for more.`,
    code: 'entity_cap_exceeded',
    limit: cap,
    used: currentCount,
    upgradeTier: lift,
  }
}

/**
 * Media storage quota (keepsey donor; reserved key `mediaGb`). Sums the org's stored bytes and
 * blocks ONLY the new upload that would cross the cap — reads and deletes are NEVER quota-blocked
 * (the data-ownership promise: the door is never locked on your own data). Call AFTER the EXIF
 * strip so the REAL stored size is counted, not the pre-strip upload size (routes/media.ts).
 * `limit`/`used` are reported in BYTES; the human copy speaks GB.
 */
export async function checkStorageQuota(
  db: DB,
  orgId: string,
  incomingBytes: number,
): Promise<BillingCheck> {
  const gb = limitFor('mediaGb')
  if (gb === undefined) return { ok: true }
  const quotaBytes = gb * 1024 ** 3
  const [usage] = await db
    .select({ total: sql<number>`coalesce(sum(${schema.media.sizeBytes}), 0)` })
    .from(schema.media)
    .where(eq(schema.media.organizationId, orgId))
  const used = Number(usage?.total ?? 0)
  if (used + incomingBytes <= quotaBytes) return { ok: true }
  const lift = APP_CONFIG.subscription.trialTier
  const gate = await requireTier(db, orgId, lift)
  if (gate.ok) return { ok: true }
  return {
    ok: false,
    error: `You've reached the ${gb} GB of media on the free plan. Upgrade to ${APP_CONFIG.monetization.tiers[lift].label} for more storage.`,
    code: 'storage_quota_exceeded',
    limit: quotaBytes,
    used,
    upgradeTier: lift,
  }
}

/**
 * FREE-tier history truncation (pet-pilot donor; reserved key `historyDays`). Returns the
 * earliest visible timestamp for this org, or null = unlimited (key absent, or org entitled).
 * List routes apply `gte(timeCol, cutoff)` when set and MAY echo `{ truncatedTo }` so the client
 * can render the HistoryLimitHint upsell (src/components/billing/history-limit-hint.tsx).
 */
export async function historyCutoff(db: DB, orgId: string): Promise<Date | null> {
  const days = limitFor('historyDays')
  if (days === undefined) return null
  const gate = await requireTier(db, orgId, APP_CONFIG.subscription.trialTier)
  if (gate.ok) return null
  return new Date(Date.now() - days * 86_400_000)
}

// ─── Better-Auth hook contracts (A1 — wired by the orchestrator into worker/auth.ts) ───────────

/**
 * Member cap for the Better-Auth organization plugin's `membershipLimit` callback. Enforced by
 * Better-Auth at accept-invitation AND member-add (ORGANIZATION_MEMBERSHIP_LIMIT_REACHED) — NOT
 * at invite-create, so a capped FREE org can still SEND invites; paying/trialing orgs are never
 * blocked (fail-safe). Uncapped/entitled → Number.MAX_SAFE_INTEGER.
 */
export async function membershipCapFor(db: DB, orgId: string): Promise<number> {
  const cap = limitFor('members')
  if (cap === undefined) return Number.MAX_SAFE_INTEGER
  const gate = await requireTier(db, orgId, APP_CONFIG.subscription.trialTier)
  return gate.ok ? Number.MAX_SAFE_INTEGER : cap
}

/**
 * Tenant-count creation limit for `organizationHooks.beforeCreateOrganization` (keepsey donor,
 * key renamed familySpaces → tenants). Counts orgs the user OWNS via a LIVE membership — never
 * orgs merely joined, never archived memberships, and never the auto-provisioned personal org
 * (kind='personal' is excluded so autoPersonalOrg doesn't burn the allowance). Over the cap, the
 * new org is allowed only when ANY owned org holds trialTier↑ (requireTier owns trial/grace).
 * Throws Better-Auth's APIError so the plugin surfaces a 402-class error to the client.
 */
export async function assertTenantCapacity(db: DB, userId: string): Promise<void> {
  const cap = limitFor('tenants')
  if (cap === undefined) return
  const memberships = await db
    .select({
      organizationId: schema.member.organizationId,
      role: schema.member.role,
      kind: schema.organization.kind,
    })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(
      and(
        eq(schema.member.userId, userId),
        isNull(schema.member.archivedAt),
        ne(schema.organization.kind, PERSONAL_KIND),
      ),
    )
  // Ownership is the org's KIND-AWARE creator role, never the 'owner' literal (B-1): custom-
  // vocabulary kinds rewrite the creator's member.role via applyCreatorRole, so an eq(role,
  // 'owner') SQL filter would count zero owned orgs for those apps — a silently unenforced
  // monetization cap. roleForJoin(kind, true) resolves each kind's creatorRole (unknown/legacy
  // kinds fall back to DEFAULT_KIND's, so stale data can't crash the auth hook).
  const owned = memberships.filter((m) => m.role === roleForJoin(m.kind, true))
  if (owned.length < cap) return
  for (const m of owned) {
    const gate = await requireTier(db, m.organizationId, APP_CONFIG.subscription.trialTier)
    if (gate.ok) return
  }
  throw new APIError('PAYMENT_REQUIRED', {
    message: `The free plan includes ${cap} ${APP_CONFIG.tenant.singular.toLowerCase()}${cap === 1 ? '' : 's'}. Upgrade to create more.`,
  })
}
