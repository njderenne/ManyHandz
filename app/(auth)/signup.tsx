import { useState } from 'react'
import { View } from 'react-native'
import { router, Link, useLocalSearchParams } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Alert } from '@/components/ui/alert'
import { authClient } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Signup — wired to Better-Auth (authClient.signUp.email). Mirrors Login; works once the Worker
 * auth backend is live. All user-facing copy comes from the i18n catalog via `t()`.
 */
const schema = z.object({
  name: z.string().min(2, t('auth.errorNameTooShort')),
  email: z.string().email(t('auth.errorInvalidEmail')),
  password: z.string().min(8, t('auth.errorPasswordTooShort')),
})
type Values = z.infer<typeof schema>

export default function Signup() {
  // Referral loop: app/invite/[code].tsx threads the invite code here as `?referral=<code>`.
  // After a successful signup we land back on the invite screen, which auto-redeems now that a
  // session exists — closing the signed-out → sign-up → credits loop.
  const { referral } = useLocalSearchParams<{ referral?: string }>()
  const referralCode = typeof referral === 'string' && referral.length > 0 ? referral : undefined
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      const res = await authClient.signUp.email({
        name: values.name,
        email: values.email,
        password: values.password,
      })
      if (res.error) setError(res.error.message ?? t('auth.signUpFailed'))
      else if (referralCode)
        router.replace({ pathname: '/invite/[code]', params: { code: referralCode } })
      else router.replace('/')
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  })

  return (
    <PageWrapper width="form" className="justify-center gap-5">
      <View className="items-center gap-1">
        <Text variant="h1">{t('auth.createAccount')}</Text>
        <Text variant="muted">{t('auth.joinApp', { name: APP_CONFIG.name })}</Text>
      </View>

      {error ? (
        <Alert variant="error" title={t('auth.signUpErrorTitle')} description={error} />
      ) : null}

      <Controller
        control={control}
        name="name"
        render={({ field }) => (
          <Input
            label={t('auth.nameLabel')}
            placeholder={t('auth.namePlaceholder')}
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={formState.errors.name?.message}
          />
        )}
      />
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
      <Controller
        control={control}
        name="password"
        render={({ field }) => (
          <Input
            label={t('auth.passwordLabel')}
            placeholder={t('auth.passwordPlaceholder')}
            secureTextEntry
            value={field.value}
            onChangeText={field.onChange}
            onBlur={field.onBlur}
            error={formState.errors.password?.message}
          />
        )}
      />
      <Button label={t('auth.createAccount')} loading={loading} onPress={onSubmit} />

      {/* Keep the referral code alive if the user hops to sign-in instead. */}
      <Link
        href={{ pathname: '/login', params: referralCode ? { referral: referralCode } : {} }}
        className="text-center"
      >
        <Text variant="muted">
          {t('auth.haveAccount')} <Text className="text-brand-500 dark:text-brand-400">{t('auth.signIn')}</Text>
        </Text>
      </Link>
    </PageWrapper>
  )
}
