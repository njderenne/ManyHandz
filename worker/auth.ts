import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { bearer, organization } from 'better-auth/plugins'
import { expo } from '@better-auth/expo'
import { passkey } from '@better-auth/passkey'
import { getDb, schema } from '@/lib/db'
import { createMailer } from './email/mailer'
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
      deleteUser: { enabled: true },
    },
    advanced: {
      // Cloudflare terminates every connection at the edge and puts the REAL client IP in
      // cf-connecting-ip; the default (x-forwarded-for) is client-spoofable. Better-Auth uses
      // this for session ipAddress tracking and its rate limiting — and warns at boot without it.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
    socialProviders,
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
      }),
      passkey(),
      bearer(),
    ],
    trustedOrigins: [
      env.BETTER_AUTH_URL,
      'manyhandz://', // native OAuth deep-link scheme — must match app.json `scheme`
      'http://localhost:8081', // Expo web dev server
    ],
  })
}

export type Auth = ReturnType<typeof createAuth>
