import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { API_BASE_URL } from '@/lib/api/base-url'
import { ORG_ADDITIONAL_FIELDS } from '@/lib/auth/org-fields'

/**
 * Better-Auth client (web fallback). No Expo client / SecureStore — the web build uses standard
 * cookie sessions. Metro picks this file for the web platform; native uses client.ts
 * (bearer token in SecureStore + deep-link OAuth). Same surface so call sites are identical.
 */
export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  // additionalFields mirror client.ts (and worker/auth.ts) so both Metro builds infer the same
  // org shape — `activeOrg.kind` is typed for the context layer (SPINE_SPEC §3.4).
  plugins: [organizationClient({ schema: { organization: { additionalFields: ORG_ADDITIONAL_FIELDS } } })],
})

export const { signIn, signUp, signOut, useSession, organization } = authClient
