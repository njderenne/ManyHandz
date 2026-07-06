import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { expoClient } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'
import { API_BASE_URL } from '@/lib/api/base-url'
import { ORG_ADDITIONAL_FIELDS } from '@/lib/auth/org-fields'

/**
 * Better-Auth client for Expo (React Native).
 *
 * Native sessions: the `expoClient` plugin stores the session token in SecureStore and sends it
 * as a bearer token to the Worker (cookies are unreliable in a native context). It pairs with the
 * Worker's `bearer` plugin. `scheme` matches app.json for OAuth deep-link callbacks.
 *
 * Plugins mirror the server (worker/auth.ts): organization (tenancy). Passkey is web-centric and
 * is exposed in a web-specific client in a later phase.
 */
export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  plugins: [
    // additionalFields mirror worker/auth.ts (via the shared org-fields.ts declaration) so
    // `activeOrg.kind` is typed on the active-org / org-list atoms — the context layer
    // (src/lib/context/*) branches on kind (SPINE_SPEC §3.4).
    organizationClient({ schema: { organization: { additionalFields: ORG_ADDITIONAL_FIELDS } } }),
    expoClient({
      scheme: 'manyhandz',
      storagePrefix: 'manyhandz',
      storage: SecureStore,
    }),
  ],
})

export const { signIn, signUp, signOut, useSession, organization } = authClient
