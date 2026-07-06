import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, organization } from 'better-auth/plugins'
import { expo } from '@better-auth/expo'
import { passkey } from '@better-auth/passkey'
import { and, eq, ne } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { ORG_ADDITIONAL_FIELDS } from '@/lib/auth/org-fields'             // B1
import { createMailer } from './email/mailer'
import { provisionNewUser, ensurePersonalOrg, sendWelcomeOnce } from './provision-user'
import { assertKindCreatable } from './lib/spine-hooks'                    // B1
import { membershipCapFor, assertTenantCapacity } from './billing/limits'  // A1
import { bootstrapTrial } from './billing/trial'                           // A1
import { buildTrustedOrigins } from './lib/trusted-origins'                // B6
import type { Env } from './env'

/**
 * Better-Auth instance. Construction (drizzle adapter + plugins) isn't free, so `getAuth` memoizes
 * one instance per isolate — `env` is stable across requests within an isolate, and the identity
 * check rebuilds if the runtime ever hands us a different env.
 *
 * Native-aware sessions: the `bearer` plugin lets the Expo (React Native) client authenticate
 * with an Authorization header (cookies are unreliable in a native context), pairing with the
 * Better-Auth Expo client which stores the token in SecureStore. `trustedOrigins` whitelists the
 * app's deep-link scheme (for OAuth callbacks) plus the Expo web dev origin.
 *
 * Social providers are only enabled when their credentials are present, so a freshly minted
 * app boots with email + passkey and lights up Google/Apple once secrets are set.
 *
 * MANYHANDZ (SPINE §10.3 release N): the chassis `applyCreatorRole` afterCreate rewrite is
 * deliberately NOT wired — households are created via the two-step flow (organization.create →
 * POST /:orgId/household/setup), and the setup route's creator check keys on the Better-Auth
 * 'owner' role (SPINE §4.3 interim rule). The setup route writes the household-vocabulary role
 * onto member.householdRole (the transitional truth requireOrg reads) + organization.kind.
 * Re-wire applyCreatorRole at the release-N+1 column drop.
 */
let cached: { env: Env; auth: ReturnType<typeof createAuth> } | null = null

/** Memoized per-isolate auth instance — use this in routes instead of createAuth. */
export function getAuth(env: Env) {
  if (!cached || cached.env !== env) cached = { env, auth: createAuth(env) }
  return cached.auth
}

export function createAuth(env: Env) {
  const db = getDb(env.DATABASE_URL)
  const mailer = createMailer(env)

  const socialProviders: BetterAuthOptions['socialProviders'] = {}
  if (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
    socialProviders.google = {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    }
  }
  if (env.APPLE_CLIENT_ID && env.APPLE_CLIENT_SECRET) {
    socialProviders.apple = {
      clientId: env.APPLE_CLIENT_ID,
      clientSecret: env.APPLE_CLIENT_SECRET,
    }
  }

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(db, { provider: 'pg', schema }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: async ({ user, url }) => {
        await mailer.sendPasswordReset(user.email, url)
      },
    },
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mailer.sendVerification(user.email, url)
      },
    },
    // Lets users delete their own account (Account screen's danger zone).
    user: {
      deleteUser: {
        enabled: true,
        // GDPR-erasure / zombie-data guard. Better-Auth's cascade only wipes USER-keyed rows
        // (member/session/account); the `organization` has NO FK to the user, so on a naive delete
        // the org SURVIVES — and every domain table is FK'd onDelete:'cascade' to the org, leaving
        // all of it as an unreachable zombie. The common case: a sole-member org (creator never
        // invited anyone) → all its data persists forever, contradicting the Account screen's
        // "deletes all of its data" promise.
        //
        // beforeDelete runs BEFORE the user cascade (better-auth update-user.ts), so the deleting
        // user's member rows still exist. For each org this user OWNS:
        //   • no other members → DELETE the org; its onDelete:'cascade' FKs wipe all org data
        //     (fulfilling the erasure promise).
        //   • other members remain → PROMOTE the earliest-joined remaining member to owner so they
        //     keep the org (kinder than blocking deletion; never orphans the org).
        // A no-op for a user who owns no orgs (non-owner member, or no membership at all). DB errors
        // SURFACE (the hook awaits, no swallow) — failing the delete is correct vs. leaking a zombie.
        // NOTE (§10.3): keyed on member.role='owner' — every household creator carries it until the
        // member.role := household_role cutover; the cutover wave must re-key this on the
        // household-vocabulary creator roles.
        beforeDelete: async (deletingUser) => {
          const ownedOrgs = await db
            .select({ organizationId: schema.member.organizationId })
            .from(schema.member)
            .where(and(eq(schema.member.userId, deletingUser.id), eq(schema.member.role, 'owner')))
          for (const { organizationId } of ownedOrgs) {
            // Earliest-joined remaining member (deterministic successor owner), if any.
            const [successor] = await db
              .select({ id: schema.member.id })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, organizationId),
                  ne(schema.member.userId, deletingUser.id),
                ),
              )
              .orderBy(schema.member.createdAt)
              .limit(1)
            if (successor) {
              await db
                .update(schema.member)
                .set({ role: 'owner' })
                .where(eq(schema.member.id, successor.id))
            } else {
              // Sole-member org — drop it; FK cascade erases all org-scoped data.
              await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
            }
          }
        },
      },
    },
    advanced: {
      // Cloudflare terminates every connection at the edge and puts the REAL client IP in
      // cf-connecting-ip; the default (x-forwarded-for) is client-spoofable. Better-Auth uses
      // this for session ipAddress tracking and its rate limiting — and warns at boot without it.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    socialProviders,
    databaseHooks: {
      user: {
        create: {
          // Runs once per new account. ManyHandz is team-first (autoPersonalOrg=false — households
          // are created/joined in onboarding), so only the one-time welcome email fires here.
          after: async (user) => {
            if (APP_CONFIG.tenant.autoPersonalOrg) await provisionNewUser(env, user.id, user.name)
            await sendWelcomeOnce(env, mailer, user.id, user.email, user.name)
          },
        },
      },
      session: {
        create: {
          // No-op for team-first apps (autoPersonalOrg=false) — ManyHandz activates a household
          // during onboarding instead.
          before: async (session) => {
            if (!APP_CONFIG.tenant.autoPersonalOrg) return
            const orgId = await ensurePersonalOrg(env, session.userId)
            return orgId ? { data: { ...session, activeOrganizationId: orgId } } : undefined
          },
        },
      },
    },
    plugins: [
      // Pairs with the app's @better-auth/expo client: validates the native client's
      // `expo-origin` (deep-link scheme) against trustedOrigins, so cookie-authed MUTATIONS from
      // the app pass the CSRF origin check. Without it: 403 MISSING_OR_NULL_ORIGIN on e.g.
      // organization.create from the phone (sign-in works — no cookie yet — which hides the bug).
      expo(),
      organization({
        sendInvitationEmail: async (data) => {
          const url = `${env.BETTER_AUTH_URL}/accept-invite/${data.id}`
          await mailer.sendOrgInvite(data.email, data.inviter.user.name, data.organization.name, url)
        },
        // SPINE §3.4 — kind + per-kind extension columns ride through the plugin (typed client-side
        // via the src/lib/auth/org-fields.ts mirror).
        schema: { organization: { additionalFields: ORG_ADDITIONAL_FIELDS } },
        // BILLING §8.3(1) — member cap (monetization.limits.members). Enforced by Better-Auth at
        // accept/add (NOT invite-create); paying/trialing orgs are never blocked (fail-safe).
        // The QR join route (worker/routes/onboarding.ts) enforces the same cap for code joins.
        membershipLimit: async (_user, org) => membershipCapFor(db, org.id),
        organizationHooks: {
          beforeCreateOrganization: async ({ organization: org, user }) => {
            // SPINE — validate kind (reject unknown + reserved 'personal'; absent ⇒ DEFAULT_KIND),
            // enforce KIND_CONFIGS[kind].maxPerUser. Throws APIError('BAD_REQUEST').
            await assertKindCreatable(db, { ...org, name: org.name ?? '' }, user)
            // BILLING §8.3(2) — tenant-count creation limit (limits.tenants). Counts orgs the user
            // OWNS, personal excluded; throws APIError('PAYMENT_REQUIRED') with tenant-alias copy.
            await assertTenantCapacity(db, user.id)
          },
          afterCreateOrganization: async ({ organization: org }) => {
            // BILLING §7.3 — trial bootstrap; no-op unless trialOnOrgCreate==='all' && trialDays>0.
            // (The household/setup route re-stamps the trial from setup time — same config source.)
            await bootstrapTrial(db, org.id)
            // §10.3 interim: NO applyCreatorRole — see the header note.
          },
        },
      }),
      passkey(),
      bearer(),
    ],
    // B6: BETTER_AUTH_URL + apex/www + trailing-dot FQDN variants + workers.dev + the native
    // deep-link scheme + localhost dev origins (worker/lib/trusted-origins.ts). The scheme reads
    // from APP_CONFIG (MINOR-9) — single-sourced with app.json's `scheme`.
    trustedOrigins: buildTrustedOrigins(env, { scheme: `${APP_CONFIG.scheme}://` }),
  })
}

export type Auth = ReturnType<typeof createAuth>
