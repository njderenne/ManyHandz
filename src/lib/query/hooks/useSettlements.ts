import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { Settlement } from '@/lib/db/schema'

/**
 * useSettlements — the Settle-Up ledger client hooks (mirrors useChores / useAssignments). Reads are
 * open to every household member; the Worker enforces the actor-specific write rules (a parent files
 * in family mode; only the debtor settles; the creditor or a parent forgives), so the client only
 * mirrors them for UI affordances — never to enforce.
 *
 * Also exports `paymentDeepLink()` — builds the Venmo / PayPal / Cash App deep links for a MONEY
 * settlement's "pay now" buttons (Apple Cash has no scheme; the UI shows the phone instead).
 */

export type PayoutType = 'money' | 'treat' | 'gift' | 'privilege' | 'experience' | 'custom'
export type SettledVia = 'venmo' | 'paypal' | 'cashapp' | 'apple_cash' | 'cash' | 'in_person' | 'other'

/** A settlement row decorated with both members' display names (what the ledger list renders). */
export type SettlementRow = Settlement & {
  fromMemberName: string | null
  toMemberName: string | null
}

/** Net money + non-money counts for one member-pair (members ordered so A↔B nets to one bucket). */
export type PairBalance = {
  memberA: string
  memberB: string
  /** Positive: A owes B; negative: B owes A. In cents. */
  netCentsAOwesB: number
  nonMoneyAToB: number
  nonMoneyBToA: number
}

export type SettlementsResponse = {
  balances: PairBalance[]
  pending: SettlementRow[]
  settled: SettlementRow[]
}

export type SettlementFilters = {
  /** One of the All/Money/Treats/… tabs. Omit for "All". */
  payoutType?: PayoutType
  status?: 'pending' | 'settled' | 'forgiven' | 'declined'
}

function queryString(filters: SettlementFilters): string {
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v)
  const s = params.toString()
  return s ? `?${s}` : ''
}

export function useSettlements(orgId: string, filters: SettlementFilters = {}) {
  return useQuery({
    queryKey: [...queryKeys.organizations.settlements(orgId), filters] as const,
    queryFn: () =>
      apiFetch<SettlementsResponse>(`/api/organizations/${orgId}/settlements${queryString(filters)}`),
    enabled: Boolean(orgId),
  })
}

export type CreateSettlementInput = {
  toMemberId: string
  payoutType: PayoutType
  /** Required (and only used) when payoutType === 'money'. */
  amountCents?: number
  payoutDescription?: string | null
  description: string
  /** Defaults server-side to the caller; an admin may file on another member's behalf. */
  fromMemberId?: string
}

/** Manual entry — file an IOU / promise (family: parents only; roommate/office: any member). */
export function useCreateSettlement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CreateSettlementInput) =>
      apiFetch<Settlement>(`/api/organizations/${orgId}/settlements`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) }),
  })
}

export type SettleInput = { settledVia: SettledVia; settledNote?: string | null }

/** Mark a settlement settled — only the debtor (from_member) may, recording how it was paid. */
export function useSettleSettlement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: SettleInput }) =>
      apiFetch<Settlement>(`/api/organizations/${orgId}/settlements/${id}/settle`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) }),
  })
}

/** Forgive a settlement — the creditor (to_member) or a parent waives the obligation. */
export function useForgiveSettlement(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, settledNote }: { id: string; settledNote?: string | null }) =>
      apiFetch<Settlement>(`/api/organizations/${orgId}/settlements/${id}/forgive`, {
        method: 'POST',
        body: JSON.stringify({ settledNote }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.settlements(orgId) }),
  })
}

// --- Payment deep-links (money settlements only) -----------------------------------------------

export type PaymentMethod = 'venmo' | 'paypal' | 'cashapp' | 'apple_cash'

export type PaymentDeepLink = {
  /** The deep link to open, or null when the method has no scheme (Apple Cash). */
  url: string | null
  platform: PaymentMethod
}

/** Strip a leading '@' / '$' and whitespace so a stored handle slots cleanly into a link. */
function cleanHandle(handle: string): string {
  return handle.trim().replace(/^[@$]/, '')
}

/**
 * Build a payment deep-link for a MONEY settlement's "pay now" button. Amount is in dollars (cents
 * ÷ 100) where the target wants a decimal. Apple Cash has no URL scheme — the UI shows the recipient's
 * phone and a "send via iMessage" hint instead.
 *
 *   Venmo:    venmo://paycharge?txn=pay&recipients={handle}&amount={amount}&note={note}
 *   PayPal:   https://paypal.me/{handle}/{amount}
 *   Cash App: https://cash.app/${handle}/{amount}
 */
export function paymentDeepLink(
  method: PaymentMethod,
  handle: string,
  amountCents: number,
  note = '',
): PaymentDeepLink {
  const h = encodeURIComponent(cleanHandle(handle))
  const dollars = (Math.max(0, amountCents) / 100).toFixed(2)
  switch (method) {
    case 'venmo':
      return {
        platform: 'venmo',
        url: `venmo://paycharge?txn=pay&recipients=${h}&amount=${dollars}&note=${encodeURIComponent(note)}`,
      }
    case 'paypal':
      return { platform: 'paypal', url: `https://paypal.me/${h}/${dollars}` }
    case 'cashapp':
      return { platform: 'cashapp', url: `https://cash.app/$${h}/${dollars}` }
    case 'apple_cash':
      return { platform: 'apple_cash', url: null }
  }
}
