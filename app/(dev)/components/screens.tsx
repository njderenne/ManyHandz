import { View } from 'react-native'
import { router } from 'expo-router'
import { Check, Star, Gift, Flame, Trophy, Bell, Dumbbell, ScrollText, MessageSquare, Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { List, ListItem } from '@/components/ui/list'
import { Separator } from '@/components/ui/separator'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { QRCode } from '@/components/native/qr-code'
import { formatCurrency } from '@/lib/format/currency'
import { Section } from '@/components/gallery/kit'
import { useColors } from '@/lib/config/theme'

/**
 * Screens tab — primitives assembled into realistic screen mockups (Login, Pricing, Profile,
 * FAQ). Shows how the chassis composes; these are previews, not wired to data.
 */

const PLANS = [
  { name: 'Free', price: 0, features: ['1 project', 'Community support'], highlight: false },
  { name: 'Pro', price: 19, features: ['Unlimited projects', 'Priority support', 'AI features'], highlight: true },
  { name: 'Team', price: 49, features: ['Everything in Pro', '5 seats', 'SSO'], highlight: false },
]

export default function ScreensScreen() {
  const colors = useColors()
  return (
    <PageWrapper className="gap-10 pb-24">
      <Text variant="h1">Screens</Text>

      {/* --- Patterns (real routes, not mockups) --- */}
      <Section title="Patterns" description="Wired flows — these push the real screens.">
        <List>
          <ListItem
            title="Terms of Service"
            subtitle="Config-driven legal default (pairs with Privacy)"
            left={<ScrollText color={colors.mutedForeground} size={18} />}
            onPress={() => router.push('/terms')}
          />
          <ListItem
            title="Send feedback"
            subtitle="Category + message → POST /api/feedback"
            left={<MessageSquare color={colors.mutedForeground} size={18} />}
            onPress={() => router.push('/feedback')}
          />
          <ListItem
            title="Paywall"
            subtitle="Subscription gate with plans + trial"
            left={<Sparkles color={colors.mutedForeground} size={18} />}
            onPress={() => router.push('/paywall')}
          />
        </List>
      </Section>

      {/* --- Login --- */}
      <Section title="Login">
        <Card>
          <CardContent className="gap-4 p-5">
            <View className="items-center gap-1">
              <View className="mb-2 size-14 items-center justify-center rounded-2xl bg-brand-500/10">
                <Star color={colors.brand} size={28} />
              </View>
              <Text variant="h2">Welcome back</Text>
              <Text variant="muted">Sign in to continue</Text>
            </View>
            <Input label="Email" placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" />
            <Input label="Password" placeholder="••••••••" secureTextEntry />
            <Button label="Sign in" />
            <View className="flex-row items-center gap-3">
              {/* flex-1, not the default w-full — full-width lines overflow a flex row on web. */}
              <Separator className="flex-1" />
              <Text variant="caption">OR</Text>
              <Separator className="flex-1" />
            </View>
            <Button variant="outline" label="Continue with Google" />
            <Button variant="outline" label="Continue with Apple" />
            <Text variant="caption" className="text-center">
              Forgot password?
            </Text>
          </CardContent>
        </Card>
      </Section>

      {/* --- Pricing --- */}
      <Section title="Pricing">
        <View className="gap-3">
          {PLANS.map((plan) => (
            <Card key={plan.name} className={plan.highlight ? 'border-primary' : undefined}>
              <CardContent className="gap-3 p-5">
                <View className="flex-row items-center justify-between">
                  <Text variant="h3">{plan.name}</Text>
                  {plan.highlight ? <Badge label="Popular" /> : null}
                </View>
                <View className="flex-row items-end gap-1">
                  <Text variant="h1">{formatCurrency(plan.price)}</Text>
                  <Text variant="muted" className="mb-1">
                    /mo
                  </Text>
                </View>
                <View className="gap-2">
                  {plan.features.map((f) => (
                    <View key={f} className="flex-row items-center gap-2">
                      <Check color={colors.success} size={16} strokeWidth={3} />
                      <Text variant="muted">{f}</Text>
                    </View>
                  ))}
                </View>
                <Button variant={plan.highlight ? 'default' : 'outline'} label={`Choose ${plan.name}`} />
              </CardContent>
            </Card>
          ))}
        </View>
      </Section>

      {/* --- Profile --- */}
      <Section title="Profile">
        <Card>
          <CardContent className="gap-4 p-5">
            <View className="items-center gap-2">
              <Avatar name="Will Larson" size={72} />
              <View className="items-center">
                <Text variant="h3">Will Larson</Text>
                <Text variant="muted">wlarson@gearup2go.com</Text>
              </View>
              <Badge variant="success" label="Pro" />
            </View>
            <View className="flex-row justify-around">
              {[
                { label: 'Projects', value: '12' },
                { label: 'Members', value: '4' },
                { label: 'Since', value: '2026' },
              ].map((s) => (
                <View key={s.label} className="items-center">
                  <Text variant="h3">{s.value}</Text>
                  <Text variant="caption">{s.label}</Text>
                </View>
              ))}
            </View>
            <List>
              <ListItem title="Edit profile" onPress={() => {}} />
              <ListItem title="Account settings" onPress={() => {}} />
              <ListItem title="Sign out" onPress={() => {}} />
            </List>
          </CardContent>
        </Card>
      </Section>

      {/* --- Help / FAQ --- */}
      <Section title="Help / FAQ">
        <Accordion>
          <AccordionItem title="How do I reset my password?" defaultOpen>
            <Text variant="muted">Tap "Forgot password" on the login screen and follow the email link.</Text>
          </AccordionItem>
          <AccordionItem title="Can I change plans later?">
            <Text variant="muted">Yes — upgrade or downgrade anytime from billing settings.</Text>
          </AccordionItem>
          <AccordionItem title="How do I contact support?">
            <Text variant="muted">Email support@example.com — we reply within a day.</Text>
          </AccordionItem>
        </Accordion>
      </Section>

      {/* --- Notifications feed --- */}
      <Section title="Notifications feed">
        <List>
          {[
            { icon: Dumbbell, title: 'Workout reminder', sub: 'Leg day starts in 30 min', unread: true },
            { icon: Trophy, title: 'New badge earned', sub: '7-day streak 🔥', unread: true },
            { icon: Bell, title: 'Nate joined your team', sub: '2h ago', unread: false },
          ].map((n, i) => {
            const Icon = n.icon
            return (
              <ListItem
                key={i}
                title={n.title}
                subtitle={n.sub}
                left={
                  <View className="size-9 items-center justify-center rounded-full bg-accent">
                    <Icon color={colors.mutedForeground} size={18} />
                  </View>
                }
                right={n.unread ? <View className="size-2 rounded-full bg-primary" /> : undefined}
              />
            )
          })}
        </List>
      </Section>

      {/* --- Referrals --- */}
      <Section title="Referrals">
        <Card>
          <CardContent className="items-center gap-3 p-5">
            <Gift color={colors.brand} size={28} />
            <Text variant="h3">Give $10, get $10</Text>
            <Text variant="muted" className="text-center">
              Share your code — you both get credit when a friend joins.
            </Text>
            <QRCode value="https://gearup2go.com/r/WILL10" size={140} />
            <View className="rounded-lg border border-dashed border-border px-5 py-2">
              <Text variant="label">WILL10</Text>
            </View>
            <Button label="Share invite" className="self-stretch" />
            <View className="flex-row justify-around self-stretch">
              <View className="items-center">
                <Text variant="h3">3</Text>
                <Text variant="caption">Invited</Text>
              </View>
              <View className="items-center">
                <Text variant="h3">{formatCurrency(20)}</Text>
                <Text variant="caption">Earned</Text>
              </View>
            </View>
          </CardContent>
        </Card>
      </Section>

      {/* --- Streaks / gamification --- */}
      <Section title="Streaks & badges">
        <Card>
          <CardContent className="gap-4 p-5">
            <View className="flex-row items-center gap-3">
              <View className="size-14 items-center justify-center rounded-full bg-warning/15">
                <Flame color={colors.warning} size={28} />
              </View>
              <View>
                <Text variant="h2">7 days</Text>
                <Text variant="muted">Current streak — keep it going!</Text>
              </View>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Badge variant="success" label="First workout" />
              <Badge variant="success" label="7-day streak" />
              <Badge variant="outline" label="🔒 30-day streak" />
              <Badge variant="outline" label="🔒 Century club" />
            </View>
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
