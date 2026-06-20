import * as WebBrowser from 'expo-web-browser'
import { apiFetch } from '@/lib/api/client'

/**
 * Billing client — calls the auth-gated Stripe Worker routes and opens the returned Stripe URL in
 * an in-app browser. Subscription state lands on the active organization (the webhook syncs it),
 * so refetch the org after the browser closes to reflect the new tier. Requires a signed-in session.
 */

/** Start a subscription checkout for the given Stripe price. */
export async function startCheckout(priceId: string) {
  const { url } = await apiFetch<{ url: string | null }>('/api/stripe/checkout', {
    method: 'POST',
    body: JSON.stringify({ priceId }),
  })
  if (url) await WebBrowser.openBrowserAsync(url)
}

/** Open the Stripe billing portal (manage / cancel / update payment method). */
export async function openBillingPortal() {
  const { url } = await apiFetch<{ url: string | null }>('/api/stripe/portal', { method: 'POST' })
  if (url) await WebBrowser.openBrowserAsync(url)
}
