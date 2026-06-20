import { useEffect } from 'react'
import { router, useLocalSearchParams } from 'expo-router'
import { useQueryClient } from '@tanstack/react-query'
import { useToast } from '@/components/ui/toast'
import { queryKeys } from '@/lib/query/keys'
import { recordPositiveMoment, maybeAskForReview } from '@/lib/native/review-prompt'
import { t } from '@/lib/i18n'

/**
 * useCheckoutResult — closes the Stripe redirect loop. The Worker's checkout session sends the
 * browser back to `/?checkout=success` or `/?checkout=cancelled` (worker/routes/stripe.ts ~line
 * 80), so MOUNT THIS HOOK ON WHATEVER SCREEN THAT success_url POINTS AT — the app root
 * (app/index.tsx) in the template. If a minted app repoints the redirect at a /billing screen,
 * move this call there with it.
 *
 * On `success`: success toast, then invalidate the organizations tree + session. The org prefix
 * sweeps `queryKeys.billing.summary(orgId)` (see src/lib/query/keys.ts — billing is org-prefixed
 * exactly so this works), which makes useSubscription refetch the webhook-synced tier without
 * this hook having to know which org just paid — important because the redirect can land before
 * the active-org query has resolved on a fresh page load.
 *
 * On `cancelled`: a neutral toast; nothing changed server-side, so nothing to refetch.
 *
 * Either way the param is stripped via router.setParams so a re-render or back-navigation never
 * replays the toast. Mounting this on native is harmless: checkout there runs in an in-app
 * browser and refetches on close (app/paywall.tsx), so the param simply never appears.
 */
export function useCheckoutResult() {
  const { checkout } = useLocalSearchParams<{ checkout?: string }>()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!checkout) return

    if (checkout === 'success') {
      toast({
        title: t('billing.checkoutSuccessTitle'),
        description: t('billing.checkoutSuccessBody'),
        variant: 'success',
      })
      void queryClient.invalidateQueries({ queryKey: queryKeys.organizations.all })
      void queryClient.invalidateQueries({ queryKey: queryKeys.session })
      // A completed purchase is the canonical happy moment — feed the review-prompt machinery.
      void recordPositiveMoment('checkout_success').then(() => maybeAskForReview())
    } else if (checkout === 'cancelled' || checkout === 'cancel') {
      // The user backed out of checkout — neutral acknowledgement, no state to refresh.
      // ('cancelled' is the wire value stripe.ts sends; 'cancel' tolerated for repointed URLs.)
      toast({ title: t('billing.checkoutCanceledTitle'), variant: 'default' })
    }

    // Strip the param so the toast can't replay on the next render or back-navigation.
    router.setParams({ checkout: undefined })
  }, [checkout, queryClient, toast])
}
