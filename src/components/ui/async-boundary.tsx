import { View } from 'react-native'
import { Spinner } from './spinner'
import { EmptyState } from './empty-state'
import { Button } from './button'
import { t } from '@/lib/i18n'

/**
 * AsyncBoundary — the canonical "loading → error → empty → data" wrapper around a TanStack Query
 * result, so every data screen handles all four states consistently. Pass the query and (optionally)
 * `isEmpty` to show the empty state.
 *
 *   const q = useNotifications(orgId)
 *   <AsyncBoundary query={q} isEmpty={q.data?.length === 0} empty={<EmptyState … />}>
 *     {q.data!.map(…)}
 *   </AsyncBoundary>
 */
type QueryLike = {
  isLoading: boolean
  /** TanStack `isPending` — true while there's no data yet, INCLUDING a query disabled on a
   *  not-yet-ready input (e.g. an empty orgId). Without this, a disabled query reads isLoading:false
   *  and the boundary would fall through to children with undefined data → a blank screen. */
  isPending?: boolean
  isError: boolean
  error?: unknown
  refetch?: () => void
}

export function AsyncBoundary({
  query,
  children,
  loading,
  empty,
  isEmpty = false,
}: {
  query: QueryLike
  children: React.ReactNode
  loading?: React.ReactNode
  empty?: React.ReactNode
  isEmpty?: boolean
}) {
  // Loading OR still-pending-with-no-data (a query disabled on a not-yet-ready orgId is the latter):
  // show the spinner rather than ever rendering children with undefined data (a blank screen).
  if (query.isLoading || (query.isPending && !query.isError)) {
    return (
      <>
        {loading ?? (
          <View className="items-center py-12">
            <Spinner size="large" />
          </View>
        )}
      </>
    )
  }
  if (query.isError) {
    return (
      <EmptyState
        title={t('errors.generic')}
        description={query.error instanceof Error ? query.error.message : t('errors.connectionHint')}
        action={
          query.refetch ? (
            <Button
              size="sm"
              variant="outline"
              label={t('common.retry')}
              onPress={() => query.refetch?.()}
            />
          ) : undefined
        }
      />
    )
  }
  if (isEmpty) return <>{empty ?? <EmptyState title={t('common.emptyTitle')} />}</>
  return <>{children}</>
}
