import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { API_BASE_URL } from '@/lib/api/base-url'

/**
 * Better-Auth client (web fallback). No Expo client / SecureStore — the web build uses standard
 * cookie sessions. Metro picks this file for the web platform; native uses client.ts
 * (bearer token in SecureStore + deep-link OAuth). Same surface so call sites are identical.
 */
export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  plugins: [organizationClient()],
})

export const { signIn, signUp, signOut, useSession, organization } = authClient
