import { useState } from 'react'
import { View } from 'react-native'
import { Stack, useRouter } from 'expo-router'
import Constants from 'expo-constants'
import {
  Bell,
  CreditCard,
  LifeBuoy,
  LogOut,
  MessageSquare,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UserRound,
  Users,
} from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { SettingsRow } from '@/components/layout/settings-row'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/client'
import { signOutEverywhere } from '@/lib/auth/sign-out'
import { t } from '@/lib/i18n'

/**
 * Settings home — the production hub every minted app ships (the dev gallery has its own under
 * app/(dev)/). Pure navigation: each row pushes a dedicated screen, so per-app settings slot in
 * as new rows/sections without this file growing logic. The footer surfaces the build identity
 * (app version + OTA runtime version) — the first thing support asks for.
 */
export default function SettingsScreen() {
  const router = useRouter()
  const { toast } = useToast()
  const { data: session } = useSession()
  const [signingOut, setSigningOut] = useState(false)

  // Canonical sign-out (deregisters this device's push token, then ends the session). Once the
  // session clears, the global auth gate sends the now-signed-out user to /login.
  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await signOutEverywhere()
      router.replace('/')
    } catch {
      toast({ title: t('settings.signOutError'), variant: 'error' })
    } finally {
      setSigningOut(false)
    }
  }

  // App version comes from app.json `version`; runtimeVersion gates which OTA updates this
  // binary can receive. The config types allow a policy object — only render explicit strings.
  const appVersion = Constants.expoConfig?.version ?? '0.0.0'
  const runtime = Constants.expoConfig?.runtimeVersion
  const runtimeVersion = typeof runtime === 'string' ? runtime : undefined

  return (
    <PageWrapper className="gap-8 pb-24">
      <Stack.Screen options={{ headerShown: true, title: t('settings.title') }} />
      <Text variant="h1">{t('settings.title')}</Text>

      <Section title={t('settings.section.account')}>
        <Card>
          <CardContent className="gap-3">
            <SettingsRow href="/account" icon={UserRound} title={t('settings.profileSecurity')} />
            <SettingsRow href="/team" icon={Users} title={t('settings.team')} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t('settings.section.preferences')}>
        <Card>
          <CardContent className="gap-3">
            <SettingsRow
              href="/preferences"
              icon={SlidersHorizontal}
              title={t('settings.appPreferences')}
            />
            <SettingsRow href="/notifications" icon={Bell} title={t('settings.notifications')} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t('settings.section.billing')}>
        <Card>
          <CardContent className="gap-3">
            <SettingsRow href="/paywall" icon={CreditCard} title={t('settings.manageSubscription')} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t('settings.section.support')}>
        <Card>
          <CardContent className="gap-3">
            <SettingsRow href="/help" icon={LifeBuoy} title={t('settings.helpFaq')} />
            <SettingsRow href="/feedback" icon={MessageSquare} title={t('settings.sendFeedback')} />
            <SettingsRow href="/changelog" icon={Sparkles} title={t('settings.whatsNew')} />
          </CardContent>
        </Card>
      </Section>

      <Section title={t('settings.section.legal')}>
        <Card>
          <CardContent className="gap-3">
            <SettingsRow href="/privacy" icon={ShieldCheck} title={t('settings.privacyPolicy')} />
            <SettingsRow href="/terms" icon={ScrollText} title={t('settings.terms')} />
          </CardContent>
        </Card>
      </Section>

      {session ? (
        <Section title={t('settings.section.session')}>
          <Button
            variant="outline"
            icon={LogOut}
            label={t('settings.signOut')}
            loading={signingOut}
            onPress={handleSignOut}
          />
        </Section>
      ) : null}

      <View className="items-center pt-2">
        <Text variant="caption" className="text-center">
          {runtimeVersion
            ? t('settings.footer.versionRuntime', { version: appVersion, runtime: runtimeVersion })
            : t('settings.footer.version', { version: appVersion })}
        </Text>
      </View>
    </PageWrapper>
  )
}
