import { Stack } from 'expo-router'
import { View } from 'react-native'
import { Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'

/**
 * What's new — config-driven release notes (APP_CONFIG.changelog, newest first). Keep entries
 * human and product-voiced; this is user-facing, not a git log.
 */
export default function ChangelogScreen() {
  const colors = useColors()
  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: t('changelog.title') }} />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <Sparkles size={22} color={colors.brand} />
          <Text variant="h1">{t('changelog.title')}</Text>
        </View>
        <Text variant="muted">{t('changelog.subtitle')}</Text>
      </View>

      <View className="gap-3">
        {APP_CONFIG.changelog.map((release) => (
          <Card key={release.version}>
            <CardContent className="gap-2">
              <View className="flex-row items-center gap-2">
                <Badge label={`v${release.version}`} variant="secondary" />
                <Text variant="caption">{release.date}</Text>
              </View>
              {release.notes.map((note, i) => (
                <Text key={i} variant="body" className="text-muted-foreground">
                  • {note}
                </Text>
              ))}
            </CardContent>
          </Card>
        ))}
      </View>
    </PageWrapper>
  )
}
