import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Lock, Trophy } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { useColors } from '@/lib/config/theme'
import { APP_CONFIG } from '@/lib/config/app'
import { cn } from '@/lib/utils'
import { authClient, useSession } from '@/lib/auth/client'
import { useAchievements } from '@/lib/query/hooks/useAchievements'
import {
  ACHIEVEMENT_LIST,
  type AchievementDefinition,
  type AchievementTier,
} from '@/lib/achievements'
import { t, type TranslationKey } from '@/lib/i18n'
import type { AchievementUnlock } from '@/lib/db/schema'

/**
 * Achievements — the engagement trophy case. Renders the ENTIRE code-defined catalog
 * (src/lib/achievements.ts) as a grid and joins it against the caller's unlock facts
 * (useAchievements): unlocked cards are full color with their unlock date, locked cards are
 * dimmed with a lock glyph — locked-but-visible is the motivator. Progress header counts
 * unlocks over the catalog. Pushed route; signed-out visitors get a sign-in prompt
 * (same shape as app/notifications.tsx).
 */

/** Tier → pill style, all within the standard Badge variants (no bespoke colors). */
const TIER_BADGE_VARIANT: Record<AchievementTier, BadgeProps['variant']> = {
  bronze: 'outline',
  silver: 'secondary',
  gold: 'warning',
}

const TIER_LABEL_KEY: Record<AchievementTier, TranslationKey> = {
  bronze: 'achievements.tierBronze',
  silver: 'achievements.tierSilver',
  gold: 'achievements.tierGold',
}

/** Locale-formatted unlock date. Rows arrive JSON-serialized (ISO string at runtime even though
 *  the schema type says Date) — `new Date()` normalizes both; invalid → empty string. */
function unlockDate(value: AchievementUnlock['createdAt']): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

/**
 * One catalog card. `unlock` present = earned (full color + date); absent = locked (content
 * dimmed via opacity, muted icon, lock glyph). The two-per-row width pairs with the grid
 * container's flex-wrap + justify-between below.
 */
function AchievementCard({
  def,
  unlock,
}: {
  def: AchievementDefinition
  unlock: AchievementUnlock | undefined
}) {
  const colors = useColors()
  const unlocked = Boolean(unlock)
  const Icon = def.icon
  const title = t(def.titleKey)
  return (
    <Card
      className="mb-3 w-[48%]"
      accessible
      accessibilityLabel={
        unlocked
          ? t('achievements.unlockedA11y', { title })
          : t('achievements.lockedA11y', { title })
      }
    >
      <View className={cn('items-center gap-2 p-4', !unlocked && 'opacity-50')}>
        <View
          className={cn(
            'size-12 items-center justify-center rounded-full',
            unlocked ? 'bg-brand-500/10' : 'bg-accent',
          )}
        >
          <Icon size={24} color={unlocked ? colors.brand : colors.mutedForeground} />
        </View>
        <Text variant="label" numberOfLines={1} className="text-center">
          {title}
        </Text>
        <Text variant="caption" numberOfLines={2} className="text-center">
          {t(def.descriptionKey)}
        </Text>
        <Badge
          variant={TIER_BADGE_VARIANT[def.tier]}
          label={t(TIER_LABEL_KEY[def.tier])}
          className="self-center"
        />
        {unlock ? (
          <Text variant="caption" className="text-center">
            {t('achievements.unlockedOn', { date: unlockDate(unlock.createdAt) })}
          </Text>
        ) : (
          <View className="flex-row items-center gap-1">
            <Lock size={12} color={colors.mutedForeground} />
            <Text variant="caption">{t('achievements.locked')}</Text>
          </View>
        )}
      </View>
    </Card>
  )
}

export default function AchievementsScreen() {
  const colors = useColors()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const query = useAchievements(orgId)

  // Progress counts the INTERSECTION of unlocks and the catalog — an unlock row whose key was
  // removed from the catalog (see src/lib/achievements.ts) must not produce "7 of 6".
  const total = ACHIEVEMENT_LIST.length
  const unlocked = ACHIEVEMENT_LIST.filter((def) => query.unlockedKeys.has(def.key)).length

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('achievements.title') }} />
      <PageWrapper className="pb-24" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={Trophy}
            title={t('achievements.signedOutTitle')}
            description={t('achievements.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : (
          <>
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <Trophy size={22} color={colors.brand} />
                <Text variant="h1">{t('achievements.title')}</Text>
              </View>
              <Text variant="muted">{t('achievements.subtitle', { app: APP_CONFIG.name })}</Text>
            </View>

            <AsyncBoundary query={query}>
              <View className="gap-2">
                <Text
                  variant="label"
                  accessibilityLabel={t('achievements.progress', { unlocked, total })}
                >
                  {t('achievements.progress', { unlocked, total })}
                </Text>
                <Progress value={total === 0 ? 0 : (unlocked / total) * 100} />
              </View>

              <View className="flex-row flex-wrap justify-between">
                {ACHIEVEMENT_LIST.map((def) => (
                  <AchievementCard
                    key={def.key}
                    def={def}
                    unlock={query.unlockByKey.get(def.key)}
                  />
                ))}
              </View>
            </AsyncBoundary>
          </>
        )}
      </PageWrapper>
    </>
  )
}
