import { useState } from 'react'
import { View } from 'react-native'
import { router, Link, useLocalSearchParams } from 'expo-router'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Star } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Alert } from '@/components/ui/alert'
import { Separator } from '@/components/ui/separator'
import { authClient } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { t } from '@/lib/i18n'

/**
 * Login — wired to Better-Auth (authClient.signIn). Email/password + social. Works as soon as the
 * Worker (auth backend) is deployed and EXPO_PUBLIC_API_URL points at it.
 *
 * Also the worked example for the i18n convention: every user-facing string here comes from the
 * catalog via `t()` (see `src/lib/i18n/`).
 */
const schema = z.object({
  email: z.string().email(t('auth.errorInvalidEmail')),
  password: z.string().min(8, t('auth.errorPasswordTooShort')),
})
type Values = z.infer<typeof schema>

export default function Login() {
  const colors = useColors()
  // Referral loop: app/invite/[code].tsx threads the invite code here as `?referral=<code>`.
  // After a successful sign-in we land back on the invite screen, which auto-redeems now that
  // a session exists — closing the signed-out → sign-in → credits loop.
  const { referral } = useLocalSearchParams<{ referral?: string }>()
  const referralCode = typeof referral === 'string' && referral.length > 0 ? referral : undefined
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const { control, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  const onSubmit = handleSubmit(async (values) => {
    setLoading(true)
    setError(null)
    try {
      const res = await authClient.signIn.email({ email: values.email, password: values.password })
      if (res.error) setError(res.error.message ?? t('auth.signInFailed'))
      else if (referralCode)
        router.replace({ pathname: '/invite/[code]', params: { code: referralCode } })
      else router.replace('/')
    } catch {
      setError(t('errors.network'))
    } finally {
      setLoading(false)
    }
  })

  const social = async (provider: 'google' | 'apple') => {
    setError(null)
    try {
      // Social auth returns via redirect, so the referral rides the callback URL instead.
      await authClient.signIn.social({
        provider,
        callbackURL: referralCode ? `/invite/${referralCode}` : '/',
      })
    } catch {
      setError(t('auth.socialSignInFailed'))
    }
  }

  return (
    <PageWrapper width="form" className="justify-center gap-5">
      <View className="items-center gap-1">
        <View className="mb-2 size-14 items-center justify-center rounded-2xl bg-brand-500/10">
          <Star color={colors.brand} size={28} />
        </View>
        <Text variant="h1">{t('auth.welcomeBack')}</Text>
        <Text variant="muted">{t('auth.signInTo', { name: APP_CONFIG.name })}</Text>
      </View>

      {error ? (
        <Alert variant="error" title={t('auth.signInErrorTitle')} description={error} />
      ) : null}

      <Form onSubmit={onSubmit} className="gap-5">
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
        <Button label={t('auth.signIn')} loading={loading} onPress={onSubmit} />
      </Form>

      <Link href="/forgot-password" className="self-center">
        <Text variant="caption" className="text-brand-500 dark:text-brand-400">
          {t('auth.forgotPassword')}
        </Text>
      </Link>

      {/* Social buttons are gated on per-app config: a fresh mint ships with both providers
          off (Google needs a per-app OAuth client, Apple is an unfilled gap), so dead buttons
          never reach the store. The mint flips APP_CONFIG.auth.{google,apple} true once wired.
          When neither is enabled we drop the "OR" divider too, leaving plain email/password. */}
      {APP_CONFIG.auth.google || APP_CONFIG.auth.apple ? (
        <>
          <View className="flex-row items-center gap-3">
            {/* flex-1, not the default w-full — full-width lines overflow a flex row on web. */}
            <Separator className="flex-1" />
            <Text variant="caption">{t('common.or')}</Text>
            <Separator className="flex-1" />
          </View>
          {APP_CONFIG.auth.google ? (
            <Button
              variant="outline"
              label={t('auth.continueWithGoogle')}
              onPress={() => social('google')}
            />
          ) : null}
          {APP_CONFIG.auth.apple ? (
            <Button
              variant="outline"
              label={t('auth.continueWithApple')}
              onPress={() => social('apple')}
            />
          ) : null}
        </>
      ) : null}

      {/* Keep the referral code alive if the user hops to sign-up instead. */}
      <Link
        href={{ pathname: '/signup', params: referralCode ? { referral: referralCode } : {} }}
        className="text-center"
      >
        <Text variant="muted">
          {t('auth.noAccount')} <Text className="text-brand-500 dark:text-brand-400">{t('auth.signUp')}</Text>
        </Text>
      </Link>
    </PageWrapper>
  )
}
