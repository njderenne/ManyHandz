import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'
import type { MealPlanEntry } from '@/lib/db/schema'

/**
 * useMeals — the meal-planning hooks (PROMOTED feature; mirrors useChores/useShopping). Every
 * household member reads AND writes the week's plan; the Worker gates writes on membership
 * (resolveHousehold), so the client needs no permission mirror here. The plan is keyed by the
 * week's Monday (`weekStart`, YYYY-MM-DD), so every mutation invalidates that week's key. Grocery
 * generation also invalidates the target list's items.
 */

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const
export type MealType = (typeof MEAL_TYPES)[number]

export type MealIngredient = { name: string; quantity?: string; category?: string }

export type MealEntryInput = {
  date: string // YYYY-MM-DD
  mealType: MealType
  title: string
  notes?: string | null
  recipeUrl?: string | null
  ingredients?: MealIngredient[]
}

/** The week's meal entries (date is a YYYY-MM-DD string; ordered by date). */
export function useMealPlan(orgId: string, weekStart: string) {
  return useQuery({
    queryKey: queryKeys.organizations.mealPlan(orgId, weekStart),
    queryFn: () =>
      apiFetch<MealPlanEntry[]>(
        `/api/organizations/${orgId}/meal-plan?weekStart=${encodeURIComponent(weekStart)}`,
      ),
    enabled: Boolean(orgId && weekStart),
  })
}

export function useCreateMealEntry(orgId: string, weekStart: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: MealEntryInput) =>
      apiFetch<MealPlanEntry>(`/api/organizations/${orgId}/meal-plan`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mealPlan(orgId, weekStart) }),
  })
}

export function useUpdateMealEntry(orgId: string, weekStart: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ entryId, input }: { entryId: string; input: Partial<MealEntryInput> }) =>
      apiFetch<MealPlanEntry>(`/api/organizations/${orgId}/meal-plan/${entryId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mealPlan(orgId, weekStart) }),
  })
}

export function useDeleteMealEntry(orgId: string, weekStart: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (entryId: string) =>
      apiFetch<{ ok: boolean }>(`/api/organizations/${orgId}/meal-plan/${entryId}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.mealPlan(orgId, weekStart) }),
  })
}

export type GenerateGroceryInput = { weekStart: string; listId: string }
export type GenerateGroceryResult = { ok: boolean; itemsAdded: number }

/** Push every ingredient in the week into the given shopping list (de-duped server-side). */
export function useGenerateGroceryList(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GenerateGroceryInput) =>
      apiFetch<GenerateGroceryResult>(`/api/organizations/${orgId}/meal-plan/generate-grocery`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (_data, { listId }) =>
      queryClient.invalidateQueries({ queryKey: queryKeys.organizations.shoppingItems(orgId, listId) }),
  })
}
