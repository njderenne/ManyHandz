import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { ShoppingList, ShoppingItem } from '@/lib/db/schema'

/**
 * useShopping — the shared shopping/supply-lists hooks (mirrors useChores/useAssignments). Every
 * household member reads AND writes; the Worker gates writes on membership (resolveHousehold), so the
 * client needs no permission mirror here. Lists invalidate the shoppingLists key; items invalidate
 * the per-list shoppingItems key.
 */

/** The 13 quick-add categories (mirrors SHOPPING_CATEGORIES in worker/routes/shopping.ts). */
export const SHOPPING_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'bakery',
  'frozen',
  'pantry',
  'beverages',
  'snacks',
  'cleaning',
  'household',
  'personal',
  'pets',
  'other',
] as const
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number]

// --- Lists ---

export function useShoppingLists(orgId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.shoppingLists(orgId),
    queryFn: () => apiFetch<ShoppingList[]>(`/api/organizations/${orgId}/shopping-lists`),
    enabled: Boolean(orgId),
  })
}

export type ShoppingListInput = { name?: string; icon?: string; sortOrder?: number }

export function useCreateShoppingList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ShoppingListInput = {}) =>
      apiFetch<ShoppingList>(`/api/organizations/${orgId}/shopping-lists`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingLists(orgId) }),
  })
}

export type UpdateShoppingListInput = Partial<{ name: string; icon: string; sortOrder: number; isArchived: boolean }>

export function useUpdateShoppingList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ listId, input }: { listId: string; input: UpdateShoppingListInput }) =>
      apiFetch<ShoppingList>(`/api/organizations/${orgId}/shopping-lists/${listId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingLists(orgId) }),
  })
}

export function useDeleteShoppingList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (listId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/shopping-lists/${listId}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingLists(orgId) }),
  })
}

// --- Items ---

export function useShoppingItems(orgId: string, listId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.shoppingItems(orgId, listId),
    queryFn: () => apiFetch<ShoppingItem[]>(`/api/organizations/${orgId}/shopping-lists/${listId}/items`),
    enabled: Boolean(orgId && listId),
  })
}

export type ShoppingItemInput = {
  name: string
  quantity?: string | null
  /** Omit to let the Worker keyword-categorize the name into one of the 13 categories. */
  category?: ShoppingCategory | null
  note?: string | null
  assignedToMemberId?: string | null
}

/** Quick-add an item to a list; the Worker auto-categorizes when `category` is omitted. */
export function useAddShoppingItem(orgId: string, listId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: ShoppingItemInput) =>
      apiFetch<ShoppingItem>(`/api/organizations/${orgId}/shopping-lists/${listId}/items`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingItems(orgId, listId) }),
  })
}

export type UpdateShoppingItemInput = Partial<{
  name: string
  quantity: string | null
  category: ShoppingCategory | null
  note: string | null
  assignedToMemberId: string | null
  isChecked: boolean
}>

export function useUpdateShoppingItem(orgId: string, listId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, input }: { itemId: string; input: UpdateShoppingItemInput }) =>
      apiFetch<ShoppingItem>(`/api/organizations/${orgId}/shopping-lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingItems(orgId, listId) }),
  })
}

/** Toggle an item's checked state (sets checkedByMemberId + checkedAt server-side). */
export function useCheckShoppingItem(orgId: string, listId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ itemId, isChecked }: { itemId: string; isChecked: boolean }) =>
      apiFetch<ShoppingItem>(`/api/organizations/${orgId}/shopping-lists/${listId}/items/${itemId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isChecked }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingItems(orgId, listId) }),
  })
}

export function useDeleteShoppingItem(orgId: string, listId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (itemId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/shopping-lists/${listId}/items/${itemId}`, {
        method: 'DELETE',
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingItems(orgId, listId) }),
  })
}
