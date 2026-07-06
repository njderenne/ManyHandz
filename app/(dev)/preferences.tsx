import { View, Pressable } from 'react-native'
import { Link, type Href } from 'expo-router'
import { Boxes, ChevronRight, Database, LifeBuoy, MessageSquare, Sparkles, UserRound, Users } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Section } from '@/components/gallery/kit'
import { useThemeMode, useColors } from '@/lib/config/theme'
import { usePrefs } from '@/lib/prefs'
import { haptics } from '@/lib/native/haptics'
import { playSound } from '@/lib/native/sounds'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Settings — user-facing preferences, persisted across launches. Theme, haptics, and sounds are
 * the template defaults; per-app settings (notifications, account, etc.) slot in as new sections.
 */
function ToggleRow({
  title,
  description,
  value,
  onValueChange,
}: {
  title: string
  description: string
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  return (
    <View className="flex-row items-center justify-between gap-4 py-1">
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        <Text variant="caption">{description}</Text>
      </View>
      <Switch value={value} onValueChange={onValueChange} />
    </View>
  )
}

function LinkRow({ href, icon: Icon, title }: { href: Href; icon?: LucideIcon; title: string }) {
  const colors = useColors()
  return (
    <Link href={href} asChild>
      <Pressable className="flex-row items-center justify-between py-1 active:opacity-70">
        <View className="flex-row items-center gap-3">
          {Icon ? <Icon color={colors.mutedForeground} size={18} /> : null}
          <Text variant="label">{title}</Text>
        </View>
        <ChevronRight color={colors.mutedForeground} size={16} />
      </Pressable>
    </Link>
  )
}

export default function SettingsScreen() {
  const mode = useThemeMode((s) => s.mode)
  const setMode = useThemeMode((s) => s.setMode)
  const hapticsEnabled = usePrefs((s) => s.hapticsEnabled)
  const soundsEnabled = usePrefs((s) => s.soundsEnabled)
  const setHapticsEnabled = usePrefs((s) => s.setHapticsEnabled)
  const setSoundsEnabled = usePrefs((s) => s.setSoundsEnabled)

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Settings</Text>

      <Section title="Account">
        <Card>
          <CardContent className="gap-3">
            <LinkRow href="/account" icon={UserRound} title="Account" />
            <LinkRow href="/team" icon={Users} title="Team" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Appearance">
        <SegmentedControl
          value={mode}
          onValueChange={(v) => setMode(v as 'light' | 'dark' | 'system')}
          options={[
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' },
            { label: 'System', value: 'system' },
          ]}
        />
      </Section>

      <Section title="Feedback">
        <Card>
          <CardContent className="gap-3">
            <ToggleRow
              title="Haptics"
              description="Vibration on taps and confirmations"
              value={hapticsEnabled}
              onValueChange={(v) => {
                setHapticsEnabled(v)
                if (v) haptics.success() // immediate confirmation it's back on
              }}
            />
            <ToggleRow
              title="Sounds"
              description="UI sound effects"
              value={soundsEnabled}
              onValueChange={(v) => {
                setSoundsEnabled(v)
                if (v) playSound('tap')
              }}
            />
            <LinkRow href="/feedback" icon={MessageSquare} title="Send feedback" />
          </CardContent>
        </Card>
      </Section>

      <Section title="About">
        <Card>
          <CardContent className="gap-3">
            <View className="gap-0.5">
              <Text variant="label">{APP_CONFIG.name}</Text>
              <Text variant="caption">{APP_CONFIG.description}</Text>
            </View>
            <LinkRow href="/settings" icon={UserRound} title="Production settings home" />
            <LinkRow href="/preferences" icon={MessageSquare} title="Preferences" />
            <LinkRow href="/notifications" icon={MessageSquare} title="Notifications" />
            <LinkRow href="/help" icon={LifeBuoy} title="Help & FAQ" />
            <LinkRow href="/changelog" icon={Sparkles} title="What's new" />
            <LinkRow href="/stack" icon={Boxes} title="Tech stack" />
            <LinkRow href="/schema" icon={Database} title="Database schema" />
            <LinkRow href="/privacy" title="Privacy policy" />
            <LinkRow href="/terms" title="Terms of Service" />
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
