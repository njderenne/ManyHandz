import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { PointGift } from '@/lib/db/schema'

/**
 * useGifts — point gifting (mirrors useChores). Reads are available to every household member; the
 * Worker gates the send by the mode permission matrix (`giftPoints`, plus the family kid toggle
 * `allowKidGifting`), so the client only mirrors that for UI affordances — never to enforce.
 *
 * Sending a gift moves points through the credit ledger (a negative entry for the sender, a positive
 * one for the receiver), so invalidate `members` (derived balances) alongside `gifts` on success.
 */
export type GiftType = 'general' | 'thank_you' | 'birthday' | 'bonus'

export type SendGiftInput = {
  toMemberId: string
  points: number
  note?: string | null
  giftType?: GiftType
}

export function useGifts(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.gifts(orgId),
    queryFn: () => apiFetch<PointGift[]>(`/api/organizations/${orgId}/gifts`),
    enabled: Boolean(orgId),
  })
}

export function useSendGift(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: SendGiftInput) =>
      apiFetch<PointGift>(`/api/organizations/${orgId}/gifts`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.gifts(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.members(orgId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.activityFeed(orgId) })
    },
  })
}
