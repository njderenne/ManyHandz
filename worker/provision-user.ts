import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { trialBootstrapFields } from './billing/trial'
import type { Mailer } from './email/mailer'
import type { Env } from './env'

/**
 * New-user provisioning — the chassis-native replacement for a Postgres `handle_new_user` trigger
 * (the stack has no DB triggers). Wired from the Better-Auth hooks (auth.ts):
 *  - user.create.after     — provisions on account creation, and
 *  - session.create.before — provisions-if-missing so the FIRST session (signup) reliably gets an
 *    active org even though signup creates the session before user.create.after commits.
 *
 * When APP_CONFIG.tenant.autoPersonalOrg is on (the solo-first default), every signup gets their own
 * personal org (kind='personal') so ~95% of users never think about tenancy and every `requireOrg`
 * route resolves immediately — without it, a fresh solo user dead-ends at the org gate. The org is
 * bootstrapped into a trial when config allows (trialBootstrapFields — trialOnOrgCreate + trialDays;
 * entitlements treats a live trial as >= the configured trial tier). FULLY IDEMPOTENT +
 * concurrency-safe: the two hooks can race during signup without creating duplicate orgs/members.
 *
 * Team-first apps set autoPersonalOrg=false and create the org during onboarding instead — keep this
 * the ONLY place new-user bootstrap lives so the contract stays in one spot. Per-app seeds (default
 * preferences, sample rows) belong in the minted app, called right after provisionNewUser.
 */

function firstName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim()
  if (!trimmed) return 'My'
  return trimmed.split(/\s+/)[0]
}

/** Idempotent + concurrency-safe. Creates a personal org + owner membership + user settings. Returns the org id. */
export async function provisionNewUser(env: Env, userId: string, userName: string | null): Promise<string> {
  const db = getDb(env.DATABASE_URL)
  const slug = `personal-${userId}` // unique + stable per user; never surfaced (personal orgs have no UI)

  // Personal org. id is supplied explicitly (Better-Auth's organization.id has no DB default).
  // onConflictDoNothing on the unique slug makes a concurrent second call a no-op; we then resolve
  // the real id by slug (NOT the local uuid, which was never inserted). The trial stamp honors
  // APP_CONFIG.subscription.trialOnOrgCreate (worker/billing/trial.ts): 'all'/'personal' stamp
  // trialing + trialEndsAt here; 'none' (or trialDays 0) provisions with no trial.
  const [inserted] = await db
    .insert(schema.organization)
    .values({
      id: crypto.randomUUID(),
      name: `${firstName(userName)}'s ${APP_CONFIG.tenant.singular}`,
      slug,
      kind: 'personal',
      subscriptionTier: 'FREE',
      ...trialBootstrapFields(),
    })
    .onConflictDoNothing({ target: schema.organization.slug })
    .returning({ id: schema.organization.id })
  let orgId = inserted?.id
  if (!orgId) {
    const [existing] = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .where(eq(schema.organization.slug, slug))
      .limit(1)
    if (!existing) throw new Error(`failed to provision personal org for ${userId}`)
    orgId = existing.id
  }

  // Owner membership (member.id has no DB default; guard on existence — member has no unique(org,user)).
  const [membership] = await db
    .select({ id: schema.member.id })
    .from(schema.member)
    .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, userId)))
    .limit(1)
  if (!membership) {
    await db.insert(schema.member).values({ id: crypto.randomUUID(), organizationId: orgId, userId, role: 'owner' })
  }

  // Server-side user settings (unique on userId → onConflictDoNothing).
  await db.insert(schema.userSettings).values({ userId }).onConflictDoNothing()

  return orgId
}

/** The user's personal org id, provisioning it first if it doesn't exist yet (signup race). */
export async function ensurePersonalOrg(env: Env, userId: string): Promise<string | null> {
  const db = getDb(env.DATABASE_URL)
  const [row] = await db
    .select({ orgId: schema.member.organizationId })
    .from(schema.member)
    .innerJoin(schema.organization, eq(schema.organization.id, schema.member.organizationId))
    .where(and(eq(schema.member.userId, userId), eq(schema.organization.kind, 'personal')))
    .limit(1)
  if (row?.orgId) return row.orgId
  // Not provisioned yet (signup created the session before user.create.after committed) — do it now.
  const [u] = await db.select({ name: schema.user.name }).from(schema.user).where(eq(schema.user.id, userId)).limit(1)
  if (!u) return null // user row not visible yet — extremely unlikely; the session hook retries next request
  return provisionNewUser(env, userId, u.name)
}

/**
 * Lifecycle welcome email — sent exactly once per account, stamped on user_settings.welcomeEmailSentAt
 * for idempotency (and as a first-time-user signal). Best-effort: a mail hiccup must never block signup.
 */
export async function sendWelcomeOnce(env: Env, mailer: Mailer, userId: string, email: string, name: string): Promise<void> {
  try {
    const db = getDb(env.DATABASE_URL)
    const [s] = await db
      .select({ sentAt: schema.userSettings.welcomeEmailSentAt })
      .from(schema.userSettings)
      .where(eq(schema.userSettings.userId, userId))
      .limit(1)
    if (s?.sentAt) return // already welcomed
    await mailer.sendWelcome(email, name)
    await db
      .insert(schema.userSettings)
      .values({ userId, welcomeEmailSentAt: new Date() })
      .onConflictDoUpdate({ target: schema.userSettings.userId, set: { welcomeEmailSentAt: new Date() } })
  } catch (err) {
    console.warn(`[provision] welcome email skipped for ${userId}:`, err)
  }
}
