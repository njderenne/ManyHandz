import { describe, it, expect, vi } from 'vitest'
import type { DB } from '@/lib/db'

/**
 * Cap-helper tests run against a MOCKED APP_CONFIG whose monetization.limits is populated —
 * the template ships `limits: {}` (every enforcement a no-op), so the over-cap branches are
 * only reachable with a config an actual minted app would have.
 */
vi.mock('@/lib/config/app', () => ({
  APP_CONFIG: {
    subscription: { trialDays: 14, gracePeriodDays: 3, trialTier: 'STANDARD', trialOnOrgCreate: 'all' },
    monetization: {
      tiers: {
        FREE: { label: 'Free' },
        STANDARD: { label: 'Pro' },
        PREMIUM: { label: 'Premium' },
      },
      sellableTiers: ['FREE', 'STANDARD', 'PREMIUM'],
      requireSubscription: false,
      lifetimeTier: 'PREMIUM',
      limits: { widgets: 2, historyDays: 7, members: 3, tenants: 1, mediaGb: 1 },
      paidFeatures: [],
    },
    tenant: { singular: 'Organization', plural: 'Organizations', autoPersonalOrg: true },
  },
}))

// Imports AFTER the mock so limits.ts (and its requireTier/limitFor deps) see the mocked config.
import { checkEntityCap, checkStorageQuota, historyCutoff, membershipCapFor, assertTenantCapacity } from './limits'

const DAY = 86_400_000

/**
 * Minimal thenable-chain Drizzle mock: every method returns the chain; each AWAIT pops the next
 * queued result set (in query order). Enough for select-chains of any shape.
 */
function fakeDb(results: unknown[][] = []): DB {
  const queue = [...results]
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = queue.shift() ?? []
          return (resolve: (v: unknown) => void) => resolve(rows)
        }
        return () => chain
      },
    },
  )
  return chain as DB
}

/** An organization row as resolveTier selects it (effectiveTier's BillingColumns superset). */
const orgRow = (tier: 'FREE' | 'STANDARD' | 'PREMIUM') => ({
  id: 'org1',
  subscriptionTier: tier,
  subscriptionStatus: null,
  trialEndsAt: null,
  currentPeriodEnd: null,
})

describe('checkEntityCap', () => {
  it('absent limits key → ok (uncapped no-op), zero queries', async () => {
    const gate = await checkEntityCap(fakeDb(), 'org1', 'not-a-key', 999)
    expect(gate).toEqual({ ok: true })
  })

  it('under the cap → ok without an entitlement read', async () => {
    const gate = await checkEntityCap(fakeDb(), 'org1', 'widgets', 1)
    expect(gate).toEqual({ ok: true })
  })

  it('at the cap + entitled org → ok (paid/trialing orgs sail past)', async () => {
    const gate = await checkEntityCap(fakeDb([[orgRow('STANDARD')]]), 'org1', 'widgets', 2)
    expect(gate).toEqual({ ok: true })
  })

  it('at the cap + FREE org → the canonical 402 envelope', async () => {
    const gate = await checkEntityCap(fakeDb([[orgRow('FREE')]]), 'org1', 'widgets', 2)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.code).toBe('entity_cap_exceeded')
      expect(gate.limit).toBe(2)
      expect(gate.used).toBe(2)
      expect(gate.upgradeTier).toBe('STANDARD')
      expect(gate.error).toContain('2 widgets')
    }
  })

  it('explicit liftTier overrides the trial-tier default', async () => {
    // Entitled at STANDARD but the cap lifts only at PREMIUM → still denied.
    const gate = await checkEntityCap(fakeDb([[orgRow('STANDARD')]]), 'org1', 'widgets', 2, 'PREMIUM')
    expect(gate.ok).toBe(false)
    if (!gate.ok) expect(gate.upgradeTier).toBe('PREMIUM')
  })
})

describe('checkStorageQuota (mediaGb 1)', () => {
  const GB = 1024 ** 3

  it('under quota → ok without an entitlement read', async () => {
    const gate = await checkStorageQuota(fakeDb([[{ total: 0 }]]), 'org1', 1024)
    expect(gate).toEqual({ ok: true })
  })

  it('crossing the cap + FREE org → storage_quota_exceeded (bytes in limit/used)', async () => {
    const used = GB - 100
    const gate = await checkStorageQuota(fakeDb([[{ total: used }], [orgRow('FREE')]]), 'org1', 200)
    expect(gate.ok).toBe(false)
    if (!gate.ok) {
      expect(gate.code).toBe('storage_quota_exceeded')
      expect(gate.limit).toBe(GB)
      expect(gate.used).toBe(used)
    }
  })

  it('crossing the cap + entitled org → ok', async () => {
    const gate = await checkStorageQuota(fakeDb([[{ total: GB }], [orgRow('PREMIUM')]]), 'org1', 200)
    expect(gate).toEqual({ ok: true })
  })
})

describe('historyCutoff (historyDays 7)', () => {
  it('FREE org → a cutoff ~7 days back', async () => {
    const cutoff = await historyCutoff(fakeDb([[orgRow('FREE')]]), 'org1')
    expect(cutoff).toBeInstanceOf(Date)
    const delta = Date.now() - (cutoff as Date).getTime()
    expect(delta).toBeGreaterThan(6.9 * DAY)
    expect(delta).toBeLessThanOrEqual(7 * DAY + 1000)
  })

  it('entitled org → null (unlimited window)', async () => {
    expect(await historyCutoff(fakeDb([[orgRow('STANDARD')]]), 'org1')).toBeNull()
  })
})

describe('membershipCapFor (members 3)', () => {
  it('FREE org → the configured cap', async () => {
    expect(await membershipCapFor(fakeDb([[orgRow('FREE')]]), 'org1')).toBe(3)
  })

  it('entitled org → effectively unlimited', async () => {
    expect(await membershipCapFor(fakeDb([[orgRow('STANDARD')]]), 'org1')).toBe(Number.MAX_SAFE_INTEGER)
  })
})

describe('assertTenantCapacity (tenants 1)', () => {
  it('under the cap → resolves (owned count 0)', async () => {
    await expect(assertTenantCapacity(fakeDb([[]]), 'user1')).resolves.toBeUndefined()
  })

  it('at the cap with every owned org FREE → throws PAYMENT_REQUIRED with tenant-alias copy', async () => {
    const db = fakeDb([
      // Ownership is kind-aware (roleForJoin(kind, true)) — ManyHandz's family creatorRole is
      // 'parent', so the owned row must carry the household vocabulary, not the 'owner' literal.
      [{ organizationId: 'orgA', role: 'parent', kind: 'family' }], // owned non-personal orgs
      [orgRow('FREE')], // requireTier read for orgA
    ])
    await expect(assertTenantCapacity(db, 'user1')).rejects.toThrow(/free plan includes 1 organization/)
  })

  it('at the cap but one owned org is entitled → resolves (fail-safe for paying users)', async () => {
    const db = fakeDb([
      [
        { organizationId: 'orgA', role: 'owner', kind: 'team' },
        { organizationId: 'orgB', role: 'owner', kind: 'team' },
      ],
      [orgRow('FREE')], // orgA: not entitled
      [orgRow('PREMIUM')], // orgB: entitled → allowed
    ])
    await expect(assertTenantCapacity(db, 'user1')).resolves.toBeUndefined()
  })

  it('ownership is KIND-AWARE (B-1): only the kind\'s creatorRole counts, never a role literal', async () => {
    // Memberships that are NOT ownership: a plain joiner role, and an unknown/legacy kind whose
    // row carries a role that isn't DEFAULT_KIND's creatorRole. Neither may trip the cap.
    const db = fakeDb([
      [
        { organizationId: 'orgA', role: 'member', kind: 'team' },
        { organizationId: 'orgB', role: 'coach', kind: 'legacy_kind' },
      ],
    ])
    await expect(assertTenantCapacity(db, 'user1')).resolves.toBeUndefined()
  })
})
