import { useState } from 'react'
import { Platform, View } from 'react-native'
import { router, Stack } from 'expo-router'
import Constants from 'expo-constants'
import { Send } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/components/ui/toast'
import { apiFetch, ApiError } from '@/lib/api/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Send feedback — the in-app feedback form (Settings → Send feedback). A low-friction channel so
 * bug reports and ideas land with the app version + platform attached instead of arriving as
 * context-free support email. POSTs to the Worker's /api/feedback; the server attributes the
 * session user, so the client only sends what it alone knows.
 */

// `t()` is safe at module scope (see src/lib/i18n) — the catalog is static and synchronous.
const CATEGORIES = [
  { label: t('feedback.categoryBug'), value: 'bug' },
  { label: t('feedback.categoryIdea'), value: 'idea' },
  { label: t('feedback.categoryOther'), value: 'other' },
] as const

export default function FeedbackScreen() {
  const { toast } = useToast()
  const [category, setCategory] = useState<string>('bug')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const trimmed = message.trim()
    if (!trimmed) {
      toast({
        title: t('feedback.validationRequired'),
        description: t('feedback.validationHint'),
        variant: 'error',
      })
      return
    }
    setSubmitting(true)
    try {
      await apiFetch('/api/feedback', {
        method: 'POST',
        body: JSON.stringify({
          category,
          message: trimmed,
          appVersion: Constants.expoConfig?.version ?? 'unknown',
          platform: Platform.OS,
        }),
      })
      toast({ title: t('feedback.submitted'), variant: 'success' })
      // Deep links have no in-app history — back() would no-op, so fall home instead.
      if (router.canGoBack()) router.back()
      else router.replace('/')
    } catch (e) {
      toast({
        title: t('feedback.submitFailed'),
        description: e instanceof ApiError ? e.message : t('errors.connectionHint'),
        variant: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('feedback.title') }} />
      <PageWrapper width="form" className="gap-5 pb-16">
        <View className="gap-1">
          <Text variant="h1">{t('feedback.title')}</Text>
          <Text variant="muted">{t('feedback.subtitle', { app: APP_CONFIG.name })}</Text>
        </View>
        <SegmentedControl
          value={category}
          onValueChange={setCategory}
          options={[...CATEGORIES]}
        />
        <Card>
          <CardContent className="gap-3">
            <Textarea
              label={t('feedback.messageLabel')}
              placeholder={
                category === 'bug' ? t('feedback.placeholderBug') : t('feedback.placeholderIdea')
              }
              rows={6}
              value={message}
              onChangeText={setMessage}
            />
            <Text variant="caption">
              {t('feedback.autoMetadata', { version: Constants.expoConfig?.version ?? 'unknown' })}
            </Text>
          </CardContent>
        </Card>
        <Button icon={Send} label={t('feedback.submit')} loading={submitting} onPress={submit} />
      </PageWrapper>
    </>
  )
}
