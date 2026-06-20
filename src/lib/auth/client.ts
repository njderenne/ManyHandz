import { createAuthClient } from 'better-auth/react'
import { organizationClient } from 'better-auth/client/plugins'
import { expoClient } from '@better-auth/expo/client'
import * as SecureStore from 'expo-secure-store'
import { API_BASE_URL } from '@/lib/api/base-url'

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
    organizationClient(),
    expoClient({
      scheme: 'apptemplate',
      storagePrefix: 'apptemplate',
      storage: SecureStore,
    }),
  ],
})

export const { signIn, signUp, signOut, useSession, organization } = authClient
