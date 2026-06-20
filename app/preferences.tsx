import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { BellRing, UserRound } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useSession } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors, useThemeMode, type ThemeMode } from '@/lib/config/theme'
import { usePrefs } from '@/lib/prefs'
import { type UnitSystem } from '@/lib/config/units'
import { t } from '@/lib/i18n'
import {
  resolveNotificationPrefs,
  useUpdateUserSettings,
  useUserSettings,
  type NotificationPrefs,
  type UpdateUserSettingsInput,
} from '@/lib/query/hooks/useUserSettings'

/**
 * Preferences — appearance plus server-side user settings (user_settings via /api/user/settings):
 * notification channels and marketing consent. Server toggles save immediately through the
 * optimistic mutation (no save button) — flips feel instant, roll back with an error toast on
 * failure. Appearance is device-local (the persisted theme store), so it renders outside the
 * session gate and works signed out.
 */

/** A label + caption row with a trailing switch — the standard settings toggle. */
function ToggleRow({
  title,
  description,
  value,
  disabled,
  onValueChange,
}: {
  title: string
  description: string
  value: boolean
  disabled?: boolean
  onValueChange: (v: boolean) => void
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-1">
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        <Text variant="caption">{description}</Text>
      </View>
      <Switch value={value} disabled={disabled} onValueChange={onValueChange} />
    </View>
  )
}

/** Device-local theme picker — instant, persisted on-device, no account needed. */
function AppearanceSection() {
  const mode = useThemeMode((s) => s.mode)
  const setMode = useThemeMode((s) => s.setMode)
  return (
    <Section title={t('preferences.appearanceSection')}>
      <Card>
        <CardContent className="gap-3">
          <SegmentedControl
            value={mode}
            onValueChange={(v) => setMode(v as ThemeMode)}
            options={[
              { label: t('preferences.themeLight'), value: 'light' },
              { label: t('preferences.themeDark'), value: 'dark' },
              { label: t('preferences.themeSystem'), value: 'system' },
            ]}
          />
          <Text variant="caption">{t('preferences.appearanceHint')}</Text>
        </CardContent>
      </Card>
    </Section>
  )
}

/** Device-local measurement units — instant, persisted on-device, no account needed. */
function UnitsSection() {
  const unitSystem = usePrefs((s) => s.unitSystem)
  const setUnitSystem = usePrefs((s) => s.setUnitSystem)
  return (
    <Section title={t('preferences.unitsSection')}>
      <Card>
        <CardContent className="gap-3">
          <SegmentedControl
            value={unitSystem}
            onValueChange={(v) => setUnitSystem(v as UnitSystem)}
            options={[
              { label: t('preferences.unitsImperial'), value: 'imperial' },
              { label: t('preferences.unitsMetric'), value: 'metric' },
            ]}
          />
          <Text variant="caption">{t('preferences.unitsHint')}</Text>
        </CardContent>
      </Card>
    </Section>
  )
}

function SignedIn() {
  const { toast } = useToast()
  const { data: settings, isPending, isError, refetch } = useUserSettings()
  const update = useUpdateUserSettings()

  // A failed initial load gets an explicit error state with retry — never switches that just
  // sit disabled forever with no explanation.
  if (isError) {
    return (
      <EmptyState
        icon={BellRing}
        title={t('errors.generic')}
        description={t('errors.connectionHint')}
        action={<Button variant="outline" label={t('common.retry')} onPress={() => refetch()} />}
      />
    )
  }

  // Full-shape prefs (defaults overlaid), so rows render sensibly even before the row loads.
  const prefs = resolveNotificationPrefs(settings)
  // Toggles stay disabled until the server row arrives — flipping a default we haven't confirmed
  // could silently invert the user's real choice. NOT disabled during saves: optimism is the UX.
  const disabled = isPending

  /** Save one patch; the hook applies it optimistically and rolls back on error — we just toast. */
  const save = (input: UpdateUserSettingsInput) =>
    update.mutate(input, {
      onError: () =>
        toast({
          title: t('preferences.saveFailed'),
          description: t('preferences.saveFailedHint'),
          variant: 'error',
        }),
    })

  /** Channel patches send the WHOLE channel object — the server merges by top-level key. */
  const saveChannel = (patch: Partial<NotificationPrefs>) => save({ notificationPrefs: patch })

  return (
    <>
      <Section title={t('preferences.notificationsSection')}>
        <Card>
          <CardContent className="gap-3">
            <ToggleRow
              title={t('preferences.push')}
              description={t('preferences.pushDescription')}
              value={prefs.push.enabled}
              disabled={disabled}
              onValueChange={(v) => saveChannel({ push: { ...prefs.push, enabled: v } })}
            />
            <ToggleRow
              title={t('preferences.email')}
              description={t('preferences.emailDescription')}
              value={prefs.email.enabled}
              disabled={disabled}
              onValueChange={(v) => saveChannel({ email: { ...prefs.email, enabled: v } })}
            />
            <ToggleRow
              title={t('preferences.digest')}
              description={t('preferences.digestDescription')}
              value={prefs.email.digest}
              disabled={disabled}
              onValueChange={(v) => saveChannel({ email: { ...prefs.email, digest: v } })}
            />
          </CardContent>
        </Card>
      </Section>

      <Section title={t('preferences.communicationSection')}>
        <Card>
          <CardContent className="gap-3">
            <ToggleRow
              title={t('preferences.marketing')}
              description={t('preferences.marketingDescription')}
              value={settings?.marketingOptIn ?? false}
              disabled={disabled}
              onValueChange={(v) => save({ marketingOptIn: v })}
            />
            {/* The compliance caption: this switch IS the user's recorded marketing consent. */}
            <Text variant="caption">{t('preferences.marketingConsent')}</Text>
          </CardContent>
        </Card>
      </Section>
    </>
  )
}

export default function PreferencesScreen() {
  const colors = useColors()
  const { data: session, isPending } = useSession()

  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: t('preferences.title') }} />
      <View className="gap-1">
        <View className="flex-row items-center gap-2">
          <BellRing size={22} color={colors.brand} />
          <Text variant="h1">{t('preferences.title')}</Text>
        </View>
        <Text variant="muted">{t('preferences.subtitle', { app: APP_CONFIG.name })}</Text>
      </View>

      <AppearanceSection />
      <UnitsSection />

      {isPending ? (
        <View className="items-center py-24">
          <Spinner size="large" />
        </View>
      ) : !session ? (
        <EmptyState
          icon={UserRound}
          title={t('preferences.signedOutTitle')}
          description={t('preferences.signedOutBody')}
          action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
        />
      ) : (
        <SignedIn />
      )}
    </PageWrapper>
  )
}
