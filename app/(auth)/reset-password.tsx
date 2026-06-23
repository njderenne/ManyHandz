import { useState } from 'react'
import { View } from 'react-native'
import { router, useLocalSearchParams, Link } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Alert } from '@/components/ui/alert'
import { authClient } from '@/lib/auth/client'
import { t } from '@/lib/i18n'

/**
 * Reset password — the destination of the reset email link. Reads the `token` from the deep link
 * and sets a new password (Better-Auth). Works once the Worker is live.
 */
const schema = z.object({ password: z.string().min(8, t('auth.errorPasswordTooShort')) })
type Values = z.infer<typeof schema>

export default function ResetPassword() {
  const { token } = useLocalSearchParams<{ token?: string }>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    if (!token) {
      setError(t('auth.resetLinkExpired'))
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await authClient.resetPassword({ newPassword: values.password, token })
      if (res.error) setError(res.error.message ?? t('auth.resetFailed'))
      else router.replace('/login')
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  })

  return (
    <PageWrapper width="form" className="justify-center gap-5">
      <View className="gap-1">
        <Text variant="h1">{t('auth.setNewPassword')}</Text>
        <Text variant="muted">{t('auth.setNewPasswordHint')}</Text>
      </View>

      {error ? (
        <Alert variant="error" title={t('auth.resetErrorTitle')} description={error} />
      ) : null}

      <Form onSubmit={onSubmit} className="gap-5">
        <Controller
          control={control}
          name="password"
          render={({ field }) => (
            <Input
              label={t('auth.newPasswordLabel')}
              placeholder={t('auth.passwordPlaceholder')}
              secureTextEntry
              value={field.value}
              onChangeText={field.onChange}
              onBlur={field.onBlur}
              error={formState.errors.password?.message}
            />
          )}
        />
        <Button label={t('auth.resetPassword')} loading={loading} onPress={onSubmit} />
      </Form>

      <Link href="/login" className="text-center">
        <Text variant="muted">
          {t('auth.backTo')} <Text className="text-brand-500 dark:text-brand-400">{t('auth.signInLink')}</Text>
        </Text>
      </Link>
    </PageWrapper>
  )
}
