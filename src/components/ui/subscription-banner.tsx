import { View } from 'react-native'
import { router } from 'expo-router'
import { Sparkles } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'
import { Button } from './button'

/**
 * SubscriptionBanner — an upgrade prompt for free-tier users. Drop it atop gated screens or in
 * settings. The CTA pushes the /paywall screen by default; pass `onPress` to override.
 */
export function SubscriptionBanner({
  title = 'Upgrade to Pro',
  description = 'Unlock every feature and remove limits.',
  cta = 'Upgrade',
  onPress,
  className,
}: {
  title?: string
  description?: string
  cta?: string
  onPress?: () => void
  className?: string
}) {
  const colors = useColors()
  return (
    <View
      className={cn(
        'flex-row items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 p-4',
        className,
      )}
    >
      <Sparkles color={colors.brand} size={22} />
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        <Text variant="muted">{description}</Text>
      </View>
      <Button size="sm" label={cta} onPress={onPress ?? (() => router.push('/paywall'))} />
    </View>
  )
}
