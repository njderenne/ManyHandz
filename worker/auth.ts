import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, organization } from 'better-auth/plugins'
import { defaultAc, defaultRoles } from 'better-auth/plugins/organization/access'
import { expo } from '@better-auth/expo'
import { passkey } from '@better-auth/passkey'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { APP_CONFIG } from '@/lib/config/app'
import { can, roleForJoin } from '@/lib/config/roles'
import { ORG_ADDITIONAL_FIELDS } from '@/lib/auth/org-fields'             // B1
import { createMailer } from './email/mailer'
import { provisionNewUser, ensurePersonalOrg, sendWelcomeOnce } from './provision-user'
import { assertKindCreatable, applyCreatorRole, mapInvitationRole } from './lib/spine-hooks' // B1
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
 * MANYHANDZ (SPINE §10.3 cutover COMPLETE — release N+1): member.role carries the HOUSEHOLD
 * vocabulary (parent|kid|roommate|manager|colleague; personal orgs keep 'owner').
 * `applyCreatorRole` is wired (creator of a fresh org gets the default kind's creatorRole —
 * 'parent' — and POST /:orgId/household/setup re-stamps it if the user picks another mode).
 * PLUGIN_ROLES below teaches Better-Auth's own permission checks the household vocabulary so
 * plugin-native surfaces (the Team screen's email invites: invitation create/cancel) keep
 * working; `afterAcceptInvitation` maps accepted invitation roles into the kind's vocabulary
 * (SPINE §4.2 join rule). The capability routes remain the canonical gates (B-1).
 */
let cached: { env: Env; auth: ReturnType<typeof createAuth> } | null = null

/** Memoized per-isolate auth instance — use this in routes instead of createAuth. */
export function getAuth(env: Env) {
  if (!cached || cached.env !== env) cached = { env, auth: createAuth(env) }
  return cached.auth
}

/**
 * Plugin-visible role table (SPINE §10.3 cutover): once member.role adopted the household
 * vocabulary, Better-Auth's OWN permission checks (hasPermission keyed on its static
 * owner/admin/member roles) would 403 every household member on the plugin-native surfaces the
 * app still uses — the Team screen's email invites (invitation:create on send/resend,
 * invitation:cancel on revoke). Declaring the household roles here mirrors the KIND_CONFIGS
 * capability matrix onto the plugin's statement space:
 *
 *   parent / roommate / manager → admin-shaped (they hold org:settings/org:delete,
 *                                 member:invite/set_role/remove in roles.ts)
 *   kid / colleague             → member-shaped (no privileged plugin action)
 *
 * The roles are GLOBAL to the plugin while vocabularies are per-kind — safe because the DB can
 * only ever hold a role that is valid for its org's kind (setup/join/PATCH validate, and the
 * cutover DML was vocabulary-guarded). Capability routes remain the canonical gates (B-1); this
 * table only keeps the plugin-native surfaces honest.
 */
const householdAdminAc = defaultAc.newRole({
  organization: ['update', 'delete'],
  member: ['create', 'update', 'delete'],
  invitation: ['create', 'cancel'],
})
const householdMemberAc = defaultAc.newRole({
  organization: [],
  member: [],
  invitation: [],
  ac: ['read'],
})
const PLUGIN_ROLES = {
  ...defaultRoles,
  parent: householdAdminAc,
  roommate: householdAdminAc,
  manager: householdAdminAc,
  kid: householdMemberAc,
  colleague: householdMemberAc,
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
        //   • no other live members → DELETE the org; its onDelete:'cascade' FKs wipe all org data
        //     (fulfilling the erasure promise).
        //   • live members remain but none can administer → PROMOTE the earliest-joined one to the
        //     kind's creator role (kinder than blocking deletion; never orphans the org).
        //   • a capable member remains (e.g. the other parent) → nothing to do.
        // A no-op for a user who owns no orgs (non-privileged member, or no membership at all).
        // DB errors SURFACE (the hook awaits, no swallow) — failing the delete is correct vs.
        // leaking a zombie.
        // (§10.3 cutover COMPLETE): re-keyed from the 'owner' literal onto the capability matrix —
        // "owns" now means the (kind, role) grants org:delete ('parent'/'roommate'/'manager', and
        // 'owner' in a personal org). Unlike the old single-owner world, several members may hold
        // it (two parents), so promotion only fires when NO remaining live member could still
        // administer the org.
        beforeDelete: async (deletingUser) => {
          const memberships = await db
            .select({
              organizationId: schema.member.organizationId,
              role: schema.member.role,
              kind: schema.organization.kind,
            })
            .from(schema.member)
            .innerJoin(schema.organization, eq(schema.member.organizationId, schema.organization.id))
            .where(and(eq(schema.member.userId, deletingUser.id), isNull(schema.member.archivedAt)))
          const owned = memberships.filter((m) => can(m.kind, m.role, 'org:delete'))
          for (const { organizationId, kind } of owned) {
            // LIVE remaining members, earliest-joined first (archived members lost org access —
            // they are neither successors nor a reason to keep the org alive).
            const remaining = await db
              .select({ id: schema.member.id, role: schema.member.role })
              .from(schema.member)
              .where(
                and(
                  eq(schema.member.organizationId, organizationId),
                  ne(schema.member.userId, deletingUser.id),
                  isNull(schema.member.archivedAt),
                ),
              )
              .orderBy(schema.member.createdAt)
            if (remaining.length === 0) {
              // No live members left — drop the org; FK cascade erases all org-scoped data.
              await db.delete(schema.organization).where(eq(schema.organization.id, organizationId))
            } else if (!remaining.some((m) => can(kind, m.role, 'org:settings'))) {
              // Nobody left who can administer (e.g. sole parent leaves a family of kids) —
              // promote the earliest-joined member to the kind's creator role so the org is
              // never orphaned (the old promote-to-owner, vocabulary-aware).
              await db
                .update(schema.member)
                .set({ role: roleForJoin(kind, true) })
                .where(eq(schema.member.id, remaining[0].id))
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
        // §10.3 — teach the plugin's own permission checks the household vocabulary (see
        // PLUGIN_ROLES above). Without this, a 'parent' could not send an email invite.
        // (`ac` is deliberately NOT passed: hasPermission reads `roles` directly, and the ac
        // option's narrowed generics fight the pinned types — it only matters for
        // dynamicAccessControl, which this app doesn't use.)
        roles: PLUGIN_ROLES,
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
          afterCreateOrganization: async ({ organization: org, member }) => {
            // SPINE §10.3 (cutover complete) — rewrite the creator's member.role to the kind's
            // creatorRole ('parent' for the default family kind; the household/setup route
            // re-stamps it if the user picks a different mode at setup).
            await applyCreatorRole(db, org, member)
            // BILLING §7.3 — trial bootstrap; no-op unless trialOnOrgCreate==='all' && trialDays>0.
            // (The household/setup route re-stamps the trial from setup time — same config source.)
            await bootstrapTrial(db, org.id)
          },
          afterAcceptInvitation: async ({ invitation, member, organization: org }) => {
            // SPINE §4.2 join rule — the plugin's accept copies invitation.role verbatim onto the
            // member row, but email invites carry the plugin's 'member'/'admin' vocabulary. Map it
            // into the org kind's household vocabulary ('admin'→creatorRole,
            // 'member'/unknown→defaultJoinerRole; an already-valid household role passes through).
            const mapped = mapInvitationRole((org as { kind?: string | null }).kind, invitation.role)
            if (mapped !== member.role) {
              await db.update(schema.member).set({ role: mapped }).where(eq(schema.member.id, member.id))
            }
          },
        },
      }),
      passkey(),
      bearer(),
    ],
    // B6: BETTER_AUTH_URL + apex/www + trailing-dot FQDN variants + workers.dev + the native
    // deep-link scheme + localhost dev origins (worker/lib/trusted-origins.ts). The scheme reads
    // from APP_CONFIG (MINOR-9) — single-sourced with app.json's `scheme`.
    // MANYHANDZ extra: the dist-preview QA loop (.claude/launch.json serves the static web build
    // on :4546) must pass Better-Auth's origin check too, not just the DEV_ORIGINS CORS allowlist
    // in worker/index.ts — dev-gated on the same ENVIRONMENT switch so production never carries a
    // standing localhost grant.
    trustedOrigins: buildTrustedOrigins(env, {
      scheme: `${APP_CONFIG.scheme}://`,
      extra: env.ENVIRONMENT === 'development' ? ['http://localhost:4546'] : [],
    }),
  })
}

export type Auth = ReturnType<typeof createAuth>
