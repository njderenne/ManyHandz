import { Stack } from 'expo-router'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/gallery/kit'
import { STACK } from '@/lib/config/stack'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Tech stack — renders the STACK manifest (src/lib/config/stack.ts): every technology in this app,
 * as configured, in technical verbiage. Reached from Settings → About → Tech stack.
 */
export default function StackScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Stack.Screen options={{ headerShown: true, title: 'Tech stack' }} />
      <View className="gap-1">
        <Text variant="h1">Tech stack</Text>
        <Text variant="muted">
          Everything {APP_CONFIG.name} is built on, as configured. Source of truth:
          src/lib/config/stack.ts.
        </Text>
      </View>

      {STACK.map((group) => (
        <Section key={group.title} title={group.title}>
          <Card>
            <CardContent className="gap-4">
              {group.entries.map((entry) => (
                <View key={entry.name} className="gap-0.5">
                  <Text variant="label">{entry.name}</Text>
                  <Text variant="muted" className="text-brand-500 dark:text-brand-400">
                    {entry.tech}
                  </Text>
                  <Text variant="caption">{entry.detail}</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        </Section>
      ))}
    </PageWrapper>
  )
}
