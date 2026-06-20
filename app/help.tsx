import { Stack, router } from 'expo-router'
import { View, Linking } from 'react-native'
import { LifeBuoy, Mail, MessageSquare } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'

/**
 * Help & FAQ — the standard help center every shipped app needs. Content is config-driven
 * (APP_CONFIG.help.faqs): minted apps replace the questions, the chrome stays. Escalation path:
 * in-app feedback (preferred — captures context) or support email.
 */
export default function HelpScreen() {
  const colors = useColors()
  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: t('help.title') }} />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <LifeBuoy size={22} color={colors.brand} />
          <Text variant="h1">{t('help.title')}</Text>
        </View>
        <Text variant="muted">{t('help.subtitle', { app: APP_CONFIG.name })}</Text>
      </View>

      <Accordion>
        {APP_CONFIG.help.faqs.map((faq) => (
          <AccordionItem key={faq.q} title={faq.q}>
            <Text variant="body" className="text-muted-foreground">
              {faq.a}
            </Text>
          </AccordionItem>
        ))}
      </Accordion>

      <Card>
        <CardContent className="gap-3">
          <Text variant="h3">{t('help.stillStuck')}</Text>
          <Text variant="muted">{t('help.escalation')}</Text>
          <View className="flex-row flex-wrap gap-3">
            <Button
              label={t('help.sendFeedback')}
              icon={MessageSquare}
              onPress={() => router.push('/feedback')}
            />
            <Button
              label={t('help.emailSupport')}
              variant="outline"
              icon={Mail}
              onPress={() => Linking.openURL(`mailto:${APP_CONFIG.support.email}`)}
            />
          </View>
        </CardContent>
      </Card>
    </PageWrapper>
  )
}
