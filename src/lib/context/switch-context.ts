import { useCallback } from 'react'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { authClient } from '@/lib/auth/client'
import { queryClient, asyncPersister } from '@/lib/query/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'
import { useToast } from '@/components/ui/toast'

/**
 * The AsyncStorage key the query persister writes to. MUST stay in lockstep with
 * `asyncPersister` in src/lib/query/client.ts (same `${shortName}-query-cache`). We re-derive it
 * here rather than export it from client.ts to keep that module's surface unchanged — there's one
 * canonical formula and a test (persister-key.test.ts) asserts the purge wipes it.
 */
export const PERSISTER_KEY = `${APP_CONFIG.shortName.toLowerCase()}-query-cache`

/**
 * Tear down the cached query state when the active context changes (SPINE_SPEC §6.2 — this is
 * ALSO the fleet-wide "cache purge on org switch" HIGH backport).
 *
 * Switching contexts means switching org scope — every org-scoped key (queryKeys.organizations.*)
 * now points at the WRONG tenant's data. Cross-tenant cache bleed is a SECURITY bug, not a UX bug:
 * selective invalidation is too easy to get wrong (a missed key leaks one tenant's data into
 * another), so the spine mandates the blunt instrument — clear the in-memory cache AND purge the
 * on-disk persister snapshot, so a cold reload mid-switch can't restore the previous context's
 * data either. Do NOT "optimize" this to selective invalidation.
 *
 * (purgeQueryCache in src/lib/query/client.ts covers the sign-out/account-deletion flavor of the
 * same leak; this adds the explicit removeItem backstop and is the context-switch entry point.)
 */
export async function purgeContextCache(): Promise<void> {
  queryClient.clear()
  // Belt-and-suspenders: ask the persister to drop its snapshot, and hard-remove the key in case
  // a future persister swaps its storage. Both target the same AsyncStorage entry.
  try {
    await asyncPersister.removeClient()
  } catch {
    // ignore — the explicit removeItem below is the backstop
  }
  try {
    await AsyncStorage.removeItem(PERSISTER_KEY)
  } catch {
    // Purge is best-effort: an unreachable disk must not block the switch. The in-memory clear
    // above already prevents the live UI from showing stale cross-tenant data.
  }
}

/**
 * useSwitchContext — set the active organization (context), purge all cross-tenant cache, toast.
 *
 * Returns `switchContext(organizationId)`. On a Better-Auth error or a network failure it surfaces
 * an error toast and leaves the cache intact — we only purge AFTER the switch is confirmed, so a
 * failed switch never wipes the current context's cache (success-only purge, SPINE §6.2).
 */
export function useSwitchContext(): {
  switchContext: (organizationId: string) => Promise<void>
} {
  const { toast } = useToast()

  const switchContext = useCallback(
    async (organizationId: string) => {
      try {
        const res = await authClient.organization.setActive({ organizationId })
        if (res.error || !res.data) {
          toast({
            title: t('context.switchFailed'),
            description: res.error?.message ?? t('context.switchFailedHint'),
            variant: 'error',
          })
          return
        }
        // Confirmed active → drop the previous context's cache (memory + disk) before consumers
        // refetch under the new scope.
        await purgeContextCache()
        toast({ title: t('context.switched', { name: res.data.name }), variant: 'success' })
      } catch {
        toast({
          title: t('context.switchFailed'),
          description: t('errors.network'),
          variant: 'error',
        })
      }
    },
    [toast],
  )

  return { switchContext }
}
