import { useState } from 'react'
import { View } from 'react-native'
import { Home, Search, Bell, User, Plus, ChevronRight, Moon, Shield, CreditCard, Settings } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { TopBar } from '@/components/layout/top-bar'
import { BottomNav } from '@/components/layout/bottom-nav'
import { SwipeToDismiss } from '@/components/layout/swipe-to-dismiss'
import { TenantSwitcher } from '@/components/layout/tenant-switcher'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { List, ListItem } from '@/components/ui/list'
import { Switch } from '@/components/ui/switch'
import { SubscriptionBanner } from '@/components/ui/subscription-banner'
import { FeatureGate } from '@/components/ui/feature-gate'
import { CommandPalette } from '@/components/ui/command-palette'
import { FAB } from '@/components/ui/fab'
import { Section } from '@/components/gallery/kit'
import { useThemeMode, useColors } from '@/lib/config/theme'

/** Layout tab — the app's structural chrome: headers, bottom nav, wrappers, gestures. */

export default function ChromeScreen() {
  const [navValue, setNavValue] = useState('home')
  const [cards, setCards] = useState([1, 2, 3])
  const [tenant, setTenant] = useState('1')
  const [cmdOpen, setCmdOpen] = useState(false)
  const mode = useThemeMode((s) => s.mode)
  const setMode = useThemeMode((s) => s.setMode)
  const colors = useColors()

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Layout</Text>

      <Section title="TopBar / Header">
        <View className="overflow-hidden rounded-lg border border-border">
          <TopBar title="Home" right={<Button size="sm" variant="ghost" label="Edit" />} />
        </View>
        <View className="overflow-hidden rounded-lg border border-border">
          <TopBar
            title="Project details"
            onBack={() => {}}
            right={
              <View className="size-10 items-center justify-center">
                <Plus color={colors.foreground} size={22} />
              </View>
            }
          />
        </View>
      </Section>

      <Section title="BottomNav" description="Presentational tab bar (the app uses Expo Router Tabs)">
        <View className="overflow-hidden rounded-lg border border-border">
          <BottomNav
            value={navValue}
            onValueChange={setNavValue}
            items={[
              { label: 'Home', icon: Home, value: 'home' },
              { label: 'Search', icon: Search, value: 'search' },
              { label: 'Alerts', icon: Bell, value: 'alerts' },
              { label: 'Profile', icon: User, value: 'profile' },
            ]}
          />
        </View>
      </Section>

      <Section title="Swipe to dismiss" description="Swipe a card left or right to remove it">
        {cards.length === 0 ? (
          <Card>
            <CardContent>
              <Text variant="muted">All dismissed.</Text>
              <Button size="sm" variant="outline" label="Reset" className="mt-2 self-start" onPress={() => setCards([1, 2, 3])} />
            </CardContent>
          </Card>
        ) : (
          <View className="gap-3">
            {cards.map((c) => (
              <SwipeToDismiss key={c} onDismiss={() => setCards((prev) => prev.filter((x) => x !== c))}>
                <Card>
                  <CardContent className="flex-row items-center justify-between">
                    <Text variant="label">Card {c}</Text>
                    <Text variant="caption">← swipe →</Text>
                  </CardContent>
                </Card>
              </SwipeToDismiss>
            ))}
          </View>
        )}
      </Section>

      <Section title="Composed example — Settings" description="Primitives assembled into a real screen">
        <List>
          <ListItem
            title="Notifications"
            left={<Bell color={colors.mutedForeground} size={20} />}
            right={<ChevronRight color={colors.placeholder} size={18} />}
            onPress={() => {}}
          />
          <ListItem
            title="Billing"
            subtitle="Pro plan"
            left={<CreditCard color={colors.mutedForeground} size={20} />}
            right={<ChevronRight color={colors.placeholder} size={18} />}
            onPress={() => {}}
          />
          <ListItem
            title="Security"
            left={<Shield color={colors.mutedForeground} size={20} />}
            right={<ChevronRight color={colors.placeholder} size={18} />}
            onPress={() => {}}
          />
          <ListItem
            title="Dark mode"
            left={<Moon color={colors.mutedForeground} size={20} />}
            right={<Switch value={mode === 'dark'} onValueChange={(v) => setMode(v ? 'dark' : 'light')} />}
          />
        </List>
      </Section>

      <Section title="Tenant switcher" description="Switch active organization (aliased per app)">
        <TenantSwitcher
          tenants={[
            { id: '1', name: 'Acme Inc' },
            { id: '2', name: 'Side Project' },
            { id: '3', name: 'Personal' },
          ]}
          activeId={tenant}
          onSelect={setTenant}
        />
      </Section>

      <Section title="Subscription banner">
        <SubscriptionBanner />
      </Section>

      <Section title="Feature gate" description="Renders only when a flag is on (APP_CONFIG.features)">
        <FeatureGate feature="ai" fallback={<Text variant="muted">AI flag is off — fallback shown.</Text>}>
          <Card>
            <CardContent>
              <Text variant="label">✨ AI features (flag is on)</Text>
            </CardContent>
          </Card>
        </FeatureGate>
        <FeatureGate
          feature="realtime"
          fallback={<Text variant="muted">Realtime flag is off — fallback shown.</Text>}
        >
          <Card>
            <CardContent>
              <Text variant="label">Realtime (flag on)</Text>
            </CardContent>
          </Card>
        </FeatureGate>
      </Section>

      <Section title="Command palette" description="Global search / quick actions">
        <Button
          variant="outline"
          icon={Search}
          label="Open command palette"
          onPress={() => setCmdOpen(true)}
        />
      </Section>

      <Section title="Floating action button">
        <View className="h-32 overflow-hidden rounded-lg border border-border bg-muted">
          <FAB icon={Plus} accessibilityLabel="Add item" onPress={() => {}} />
        </View>
      </Section>

      <CommandPalette
        visible={cmdOpen}
        onClose={() => setCmdOpen(false)}
        items={[
          { id: 'home', label: 'Go to Home', icon: Home, onSelect: () => {} },
          { id: 'settings', label: 'Open Settings', icon: Settings, onSelect: () => {} },
          { id: 'billing', label: 'Billing', subtitle: 'Manage your plan', icon: CreditCard, onSelect: () => {} },
          { id: 'profile', label: 'Profile', icon: User, onSelect: () => {} },
        ]}
      />
    </PageWrapper>
  )
}
