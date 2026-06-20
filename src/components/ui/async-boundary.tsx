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
  if (query.isLoading) {
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
