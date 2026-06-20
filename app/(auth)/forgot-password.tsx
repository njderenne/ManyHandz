import { useState } from 'react'
import { View } from 'react-native'
import { Link } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { authClient } from '@/lib/auth/client'
import { t } from '@/lib/i18n'

/**
 * Forgot password — requests a reset email (Better-Auth → Resend). Works once the Worker is live.
 */
const schema = z.object({ email: z.string().email(t('auth.errorInvalidEmail')) })
type Values = z.infer<typeof schema>

export default function ForgotPassword() {
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      const res = await authClient.requestPasswordReset({
        email: values.email,
        redirectTo: '/reset-password',
      })
      if (res.error) setError(res.error.message ?? t('auth.resetEmailFailed'))
      else setSent(true)
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  })

  return (
    <PageWrapper width="form" className="justify-center gap-5">
      <View className="gap-1">
        <Text variant="h1">{t('auth.forgotPassword')}</Text>
        <Text variant="muted">{t('auth.forgotPasswordHint')}</Text>
      </View>

      {sent ? (
        <Alert
          variant="success"
          title={t('auth.resetLinkSentTitle')}
          description={t('auth.resetLinkSentBody')}
        />
      ) : (
        <>
          {error ? (
            <Alert variant="error" title={t('errors.generic')} description={error} />
          ) : null}
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <Input
                label={t('auth.emailLabel')}
                placeholder={t('auth.emailPlaceholder')}
                keyboardType="email-address"
                autoCapitalize="none"
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                error={formState.errors.email?.message}
              />
            )}
          />
          <Button label={t('auth.sendResetLink')} loading={loading} onPress={onSubmit} />
        </>
      )}

      <Link href="/login" className="text-center">
        <Text variant="muted">
          {t('auth.backTo')} <Text className="text-brand-500 dark:text-brand-400">{t('auth.signInLink')}</Text>
        </Text>
      </Link>
    </PageWrapper>
  )
}
