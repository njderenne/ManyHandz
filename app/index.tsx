import { View, Pressable } from 'react-native'
import { Link } from 'expo-router'
import { useQuery } from '@tanstack/react-query'
import { Rocket } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { queryKeys } from '@/lib/query/keys'
import { apiFetch } from '@/lib/api/client'
import { useCheckoutResult } from '@/lib/billing/use-checkout-result'
import { Text } from '@/components/ui/text'
import { Card } from '@/components/ui/card'
import { t } from '@/lib/i18n'

/**
 * Home screen — smoke-tests that the Worker API is reachable via the canonical
 * query + api-client pattern. Styled with NativeWind (Tailwind classes on RN views).
 */
export default function Home() {
  const colors = useColors()
  // Stripe's checkout redirect lands here ('/?checkout=…') — toast the result + refresh billing.
  useCheckoutResult()
  const health = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiFetch<{ ok: boolean; service: string }>('/api/health'),
  })

  return (
    // Routed through PageWrapper so the hero inherits the centered content lane (no full-width
    // stretch on web). scroll={false} preserves the vertically-centered hero layout.
    <PageWrapper scroll={false} width="form">
      <View className="flex-1 items-center justify-center gap-6 p-6">
        <View className="size-16 items-center justify-center rounded-xl bg-brand-500/10">
          <Rocket color={colors.brand} size={32} />
        </View>
        <View className="items-center gap-2">
          <Text variant="h1">{APP_CONFIG.name}</Text>
          <Text variant="body" className="max-w-md text-center text-muted-foreground">
            {APP_CONFIG.description}
          </Text>
        </View>
        <Card className="px-4 py-3">
          <Text variant="label">
            {health.isLoading
              ? t('home.workerApiChecking')
              : health.data?.ok
                ? t('home.workerApiHealthy', { service: health.data.service })
                : t('home.workerApiUnreachable')}
          </Text>
        </Card>
        <Link href="/login" asChild>
          <Pressable accessibilityRole="link" className="active:opacity-70">
            <Text variant="label" className="text-brand-500 dark:text-brand-400">
              {t('home.signIn')}
            </Text>
          </Pressable>
        </Link>
        {__DEV__ ? (
          <Link href="/components" asChild>
            <Pressable accessibilityRole="link" className="active:opacity-70">
              <Text variant="label" className="text-brand-500 dark:text-brand-400">
                View component gallery →
              </Text>
            </Pressable>
          </Link>
        ) : null}
      </View>
    </PageWrapper>
  )
}
