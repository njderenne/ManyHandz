import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { Link2, CircleAlert } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { useColors } from '@/lib/config/theme'
import { apiFetch, ApiError } from '@/lib/api/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Public share-link landing — '/share/[token]'. PUBLIC (in navigation.ts PUBLIC_PREFIXES): a shared
 * link must resolve for someone with no account. Resolves the token to its minimal reference
 * (entityType, entityId, displayName) via the no-auth GET /api/share/:token, then renders it.
 *
 * This is the GENERIC scaffold — it shows the reference + a CTA into the app. A minted app REPLACES
 * the body with real content per entityType: either add a richer public resolver
 * (GET /api/shared/:type/:token that snapshots the entity) and render its payload here, or branch on
 * `entityType` to a read-only domain view. See builder/MINT.md.
 */

type ResolvedShare = { entityType: string; entityId: string | null; displayName: string | null }

export default function ShareTokenScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token: string }>()
  const token = typeof rawToken === 'string' ? rawToken : ''
  const colors = useColors()

  const [state, setState] = useState<'loading' | 'error' | 'ok'>('loading')
  const [share, setShare] = useState<ResolvedShare | null>(null)

  useEffect(() => {
    if (!token) {
      setState('error')
      return
    }
    let cancelled = false
    setState('loading')
    apiFetch<ResolvedShare>(`/api/share/${encodeURIComponent(token)}`)
      .then((res) => {
        if (cancelled) return
        setShare(res)
        setState('ok')
      })
      .catch((e) => {
        // A missing / revoked / expired token is a 404 (no oracle) — all read as "unavailable".
        if (!cancelled) setState(e instanceof ApiError ? 'error' : 'error')
      })
    return () => {
      cancelled = true
    }
  }, [token])

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('share.title') }} />
      <PageWrapper className="gap-5 pb-16">
        {state === 'loading' ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : state === 'error' || !share ? (
          <EmptyState
            icon={CircleAlert}
            title={t('share.unavailable')}
            description={t('share.unavailableHint')}
            action={<Button label={t('share.openApp', { app: APP_CONFIG.name })} onPress={() => router.replace('/')} />}
          />
        ) : (
          <View className="gap-4">
            <View className="items-center gap-3 pt-2">
              <View className="size-14 items-center justify-center rounded-2xl bg-accent">
                <Link2 color={colors.brand} size={26} />
              </View>
              <Text variant="h2" className="text-center">
                {share.displayName?.trim() || t('share.heroAnonymous')}
              </Text>
              <Text variant="muted" className="text-center">
                {t('share.shared', { kind: humanizeEntityType(share.entityType) })}
              </Text>
            </View>

            {/* Generic reference card. A minted app replaces this with the entity's real content. */}
            <Card>
              <CardContent className="gap-1 py-4">
                <Text variant="caption" className="uppercase tracking-wider">
                  {t('share.linkType')}
                </Text>
                <Text variant="label">{humanizeEntityType(share.entityType)}</Text>
              </CardContent>
            </Card>

            <Button label={t('share.openApp', { app: APP_CONFIG.name })} onPress={() => router.replace('/')} />
          </View>
        )}
      </PageWrapper>
    </>
  )
}

/** 'workout_session' → 'Workout session'. A friendly label for the generic scaffold. */
function humanizeEntityType(entityType: string): string {
  const words = entityType.replace(/[_-]+/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}
