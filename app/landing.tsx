import type { ReactNode } from 'react'
import { ScrollView, View, Pressable, type ImageSourcePropType } from 'react-native'
import { Image } from 'expo-image'
import { router, Link, Stack } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { LucideIcon } from 'lucide-react-native'
import {
  Scale, Camera, Trophy, Sparkles, Users, RotateCw, HandCoins, ShoppingCart,
  BellRing, HeartPulse, Check, Rocket,
} from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { APP_CONFIG } from '@/lib/config/app'
import { MARKETING } from '@/lib/config/marketing'
import { useColors } from '@/lib/config/theme'
import { useIsWideWeb } from '@/lib/hooks/use-is-wide-web'
import { useSession } from '@/lib/auth/client'
import { t } from '@/lib/i18n'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Gradient } from '@/components/ui/gradient'

/**
 * Landing — the public marketing page for the WEB build (and a first screen on native).
 *
 * A signed-out web visitor lands here (APP_CONFIG.authGate.redirectTo === 'landing'). The app nav is
 * hidden on /landing (NAV_HIDDEN_PREFIXES), so this owns the whole screen. On wide desktop web the
 * sections lay out in rows; everything stacks on narrow web and native. SEO meta lives in +html.tsx.
 *
 * All marketing copy below is per-app (the factory rewrites it at mint). Imagery comes from
 * builder/assets/generate-marketing.js → MARKETING slots; each falls back to a branded placeholder
 * when null. Brand mark + name + colors come from APP_CONFIG + useColors().
 */
const HERO_EYEBROW = 'Now with AI-powered photo verification'
const HERO_TITLE = 'One app. Every household. Real fairness.'
const HERO_SUBTITLE =
  'Assign and auto-rotate chores, see exactly who pulls their weight, photo-verify what got done, and turn it into a game the kids actually play. Families and roommates — one app.'

type Feature = { icon: LucideIcon; title: string; body: string }
const FEATURES: Feature[] = [
  {
    icon: Scale,
    title: 'Fairness that’s actually fair',
    body: 'Effort-weighted scoring (difficulty × time) ends the “I do everything around here” argument with real numbers.',
  },
  {
    icon: Camera,
    title: 'Done means done',
    body: 'Before-and-after photos prove the work — with optional AI that auto-approves the good ones.',
  },
  {
    icon: Trophy,
    title: 'Chores kids actually do',
    body: 'Points, levels, badges and real rewards make the dishes a game — with parent approval built in.',
  },
]

type Mode = { icon: LucideIcon; name: string; tagline: string; points: string[] }
const MODES: Mode[] = [
  {
    icon: Sparkles,
    name: 'Family mode',
    tagline: 'Parents run the show; kids earn their way.',
    points: [
      'Points, levels, badges & real rewards',
      'Parent approval before points count',
      'Goals kids save toward',
      'Allowance & settle-up built in',
    ],
  },
  {
    icon: Users,
    name: 'Roommate mode',
    tagline: 'Equal housemates — no nagging, no scorekeeping by hand.',
    points: [
      'Effort-weighted fairness, front and center',
      'Honor-system completion — no approvals',
      'Settle-Up ledger for money & favors owed',
      'Auto-rotation that survives vacations',
    ],
  },
]

const HIGHLIGHTS: Feature[] = [
  { icon: RotateCw, title: 'Auto-rotation', body: 'Recurring chores rotate themselves and skip whoever’s away.' },
  { icon: HandCoins, title: 'Settle-Up ledger', body: 'Track who owes whom — money and non-money IOUs alike.' },
  { icon: ShoppingCart, title: 'Shared lists', body: 'A household shopping list everyone can add to in real time.' },
  { icon: BellRing, title: 'Smart reminders', body: 'Gentle, well-timed nudges — let the app be the bad guy.' },
  { icon: Trophy, title: 'Streaks & badges', body: 'Momentum that keeps everyone coming back to do their part.' },
  { icon: HeartPulse, title: 'Household health score', body: 'One simple number for how your home is really doing.' },
]

const PLAN_INCLUDES = [
  'Unlimited chores, members & households',
  'Effort-weighted fairness & weekly reports',
  'Photo proof + optional AI verification',
  'Gamification, rewards & savings goals',
  'Settle-Up, shopping lists & smart reminders',
  'iOS, Android & web — always in sync',
]

const FAQS: { q: string; a: string }[] = [
  {
    q: 'Is ManyHandz for families or roommates?',
    a: 'Both. Pick your mode when you create a household — Family turns on gamification, rewards and parent approval; Roommate is an equal, fairness-first honor system. Same app, two very different experiences.',
  },
  {
    q: 'Do I need a credit card to try it?',
    a: 'No. Every household starts with a 14-day free trial — no card required. Subscribe only once you love it.',
  },
  {
    q: 'What happens when the trial ends?',
    a: 'Your household goes read-only — you can still see everything, and nothing is ever deleted or held hostage. Subscribe any time to pick up right where you left off.',
  },
  {
    q: 'How does fairness scoring work?',
    a: 'Every chore is weighted by difficulty × time, so a 40-minute deep clean counts for more than a 2-minute trash run. ManyHandz shows each person’s real share — no more guessing who does more.',
  },
  {
    q: 'How much does it cost?',
    a: '$9.99/month or $99.99/year (about 17% off). One simple plan — no ads, ever, and no nickel-and-diming.',
  },
  {
    q: 'Is our data private?',
    a: 'Yes. Everything is scoped to your household, and proof photos are private and household-only. We never sell your data or run ads.',
  },
  {
    q: 'Which devices does it work on?',
    a: 'iPhone, Android, and any web browser — your household stays in sync across all of them.',
  },
]

/** A marketing photo with a dark bottom scrim and content laid over it (feature cards + CTA). */
function OverlayCard({
  image, wide, center, children,
}: {
  image: ImageSourcePropType
  wide?: boolean
  center?: boolean
  children: ReactNode
}) {
  return (
    <View className={cn('h-56 overflow-hidden rounded-2xl', wide && 'flex-1')}>
      <Image source={image} style={{ width: '100%', height: '100%' }} contentFit="cover" transition={200} />
      <Gradient
        colors={['rgba(10,8,4,0)', 'rgba(10,8,4,0.82)']}
        direction={[0, 0, 0, 1]}
        borderRadius={0}
        className="absolute inset-0"
      />
      <View className={cn('absolute inset-x-0 p-5', center ? 'inset-y-0 items-center justify-center gap-4' : 'bottom-0 gap-1')}>
        {children}
      </View>
    </View>
  )
}

function SectionHead({ title, sub, wide }: { title: string; sub?: string; wide: boolean }) {
  return (
    <View className="w-full max-w-6xl gap-2 px-5 pb-3 pt-14">
      <Text variant="h2" className={cn(wide && 'text-4xl')}>{title}</Text>
      {sub ? <Text variant="body" className="max-w-2xl text-muted-foreground">{sub}</Text> : null}
    </View>
  )
}

function Bullet({ label, color }: { label: string; color: string }) {
  return (
    <View className="flex-row items-start gap-2">
      <Check color={color} size={18} style={{ marginTop: 1 }} />
      <Text variant="muted" className="flex-1">{label}</Text>
    </View>
  )
}

export default function LandingScreen() {
  const colors = useColors()
  const wide = useIsWideWeb()
  const { data: session } = useSession()
  const initial = (APP_CONFIG.name.trim()[0] ?? 'A').toUpperCase()
  const featureImages = [MARKETING.feature1Image, MARKETING.feature2Image, MARKETING.feature3Image]

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />

      {/* Marketing header — brand left, auth CTAs right. Pinned above the scroll. */}
      <SafeAreaView edges={['top']} className="border-b border-border bg-background">
        <View className="w-full max-w-6xl flex-row items-center justify-between gap-4 self-center px-5 py-3">
          <View className="min-w-0 shrink flex-row items-center gap-2">
            <View className="size-8 items-center justify-center rounded-lg" style={{ backgroundColor: colors.brand }}>
              <Text variant="label" style={{ color: colors.onPrimary }}>{initial}</Text>
            </View>
            <Text variant="label" numberOfLines={1}>{APP_CONFIG.name}</Text>
          </View>
          <View className="shrink-0 flex-row items-center gap-2">
            {session ? (
              <Button size="sm" label={t('landing.openApp')} onPress={() => router.replace('/')} />
            ) : (
              <>
                <Button variant="ghost" size="sm" label={t('landing.logIn')} onPress={() => router.push('/login')} />
                <Button size="sm" label={t('landing.getStarted')} onPress={() => router.push('/signup')} />
              </>
            )}
          </View>
        </View>
      </SafeAreaView>

      <ScrollView contentContainerClassName="items-center pb-16">
        {/* HERO */}
        <View className="w-full max-w-6xl px-5 pb-10 pt-10">
          <View className={cn('gap-10', wide && 'flex-row items-center')}>
            <View className={cn('gap-5', wide && 'flex-1')}>
              <View className="self-start rounded-full bg-brand-500/10 px-3 py-1">
                <Text variant="caption" style={{ color: colors.brand }}>{HERO_EYEBROW}</Text>
              </View>
              <Text variant="h1" className={cn(wide && 'text-5xl')}>{HERO_TITLE}</Text>
              <Text variant="body" className="max-w-xl text-lg text-muted-foreground">{HERO_SUBTITLE}</Text>
              <View className="flex-row flex-wrap gap-3 pt-1">
                <Button label={t('landing.getStarted')} onPress={() => router.push('/signup')} />
                <Button variant="outline" label={t('landing.signIn')} onPress={() => router.push('/login')} />
              </View>
              <Text variant="caption">14-day free trial · no credit card · cancel anytime</Text>
            </View>
            {/* Hero visual — generated marketing image, else a branded gradient placeholder. */}
            <View className={cn(wide ? 'flex-1' : 'w-full')}>
              {MARKETING.heroImage ? (
                <Image
                  source={MARKETING.heroImage}
                  style={{ width: '100%', height: wide ? 360 : 240, borderRadius: 20 }}
                  contentFit="cover"
                  transition={200}
                  accessibilityLabel="A warm, tidy home shared by a household using ManyHandz"
                />
              ) : (
                <Gradient colors={colors.brandGradient} className="h-64 items-center justify-center" borderRadius={20}>
                  <View className="size-24 items-center justify-center rounded-3xl bg-white/15">
                    <Rocket color={colors.onPrimary} size={44} />
                  </View>
                </Gradient>
              )}
            </View>
          </View>
        </View>

        {/* THREE HERO FEATURES — a generated photo per card with title + body overlaid. */}
        <View className="w-full max-w-6xl px-5 py-4">
          <View className={cn('gap-4', wide && 'flex-row')}>
            {FEATURES.map((f, i) => {
              const img = featureImages[i]
              return img ? (
                <OverlayCard key={f.title} image={img} wide={wide}>
                  <Text variant="label" className="text-white">{f.title}</Text>
                  <Text variant="caption" className="text-white/90">{f.body}</Text>
                </OverlayCard>
              ) : (
                <Card key={f.title} className={cn(wide && 'flex-1')}>
                  <CardContent className="gap-3 p-5">
                    <View className="size-10 items-center justify-center rounded-lg bg-brand-500/10">
                      <f.icon color={colors.brand} size={22} />
                    </View>
                    <Text variant="label">{f.title}</Text>
                    <Text variant="muted">{f.body}</Text>
                  </CardContent>
                </Card>
              )
            })}
          </View>
        </View>

        {/* BUILT FOR EVERY HOUSEHOLD — Family vs Roommate */}
        <SectionHead
          title="Built for every household"
          sub="One app, two modes. Choose how your home runs when you set it up — and switch households any time."
          wide={wide}
        />
        <View className="w-full max-w-6xl px-5 pt-1">
          <View className={cn('gap-4', wide && 'flex-row')}>
            {MODES.map((m) => (
              <Card key={m.name} className={cn(wide && 'flex-1')}>
                <CardContent className="gap-4 p-6">
                  <View className="flex-row items-center gap-3">
                    <View className="size-11 items-center justify-center rounded-xl bg-brand-500/10">
                      <m.icon color={colors.brand} size={24} />
                    </View>
                    <View className="flex-1">
                      <Text variant="h3">{m.name}</Text>
                      <Text variant="muted">{m.tagline}</Text>
                    </View>
                  </View>
                  <View className="gap-2 pt-1">
                    {m.points.map((p) => <Bullet key={p} label={p} color={colors.brand} />)}
                  </View>
                </CardContent>
              </Card>
            ))}
          </View>
        </View>

        {/* EVERYTHING IN ONE PLACE — highlights grid */}
        <SectionHead
          title="Everything your household needs"
          sub="Beyond chores: the small things that keep a home running, without the group-text chaos."
          wide={wide}
        />
        <View className="w-full max-w-6xl px-5 pt-1">
          <View className={cn('gap-x-4 gap-y-6', wide && 'flex-row flex-wrap justify-between')}>
            {HIGHLIGHTS.map((h) => (
              <View key={h.title} className={cn('flex-row items-start gap-3', wide && 'w-[48%]')}>
                <View className="size-10 items-center justify-center rounded-lg bg-brand-500/10">
                  <h.icon color={colors.brand} size={20} />
                </View>
                <View className="flex-1 gap-1">
                  <Text variant="label">{h.title}</Text>
                  <Text variant="muted">{h.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* PRICING */}
        <SectionHead
          title="Simple, honest pricing"
          sub="One plan, full access. No ads, no upsells, no holding your data hostage."
          wide={wide}
        />
        <View className="w-full max-w-6xl items-center px-5 pt-1">
          <Card className="w-full max-w-md">
            <CardContent className="gap-5 p-7">
              <View className="gap-1">
                <Text variant="label" style={{ color: colors.brand }}>ManyHandz · everything included</Text>
                <View className="flex-row items-end gap-1">
                  <Text variant="h1">$9.99</Text>
                  <Text variant="muted" className="pb-1">/ month</Text>
                </View>
                <Text variant="muted">or $99.99 / year — save ~17%</Text>
              </View>
              <View className="gap-2">
                {PLAN_INCLUDES.map((p) => <Bullet key={p} label={p} color={colors.brand} />)}
              </View>
              <View className="gap-2 pt-1">
                <Button label="Start your free trial" onPress={() => router.push('/signup')} />
                <Text variant="caption" className="text-center">14 days free · no credit card required</Text>
              </View>
            </CardContent>
          </Card>
        </View>

        {/* FAQ */}
        <SectionHead title="Questions, answered" wide={wide} />
        <View className="w-full max-w-3xl gap-6 px-5 pt-1">
          {FAQS.map((f) => (
            <View key={f.q} className="gap-1.5">
              <Text variant="label">{f.q}</Text>
              <Text variant="muted">{f.a}</Text>
            </View>
          ))}
        </View>

        {/* CLOSING CTA — generated photo banner, else brand gradient. */}
        <View className="w-full max-w-6xl px-5 pb-2 pt-14">
          {MARKETING.ctaImage ? (
            <OverlayCard image={MARKETING.ctaImage} center>
              <Text variant="h2" className="text-center text-white">Ready for a fairer household?</Text>
              <Button className="bg-white" onPress={() => router.push('/signup')}>
                <Text variant="label" style={{ color: colors.primary }}>{t('landing.getStarted')}</Text>
              </Button>
            </OverlayCard>
          ) : (
            <Gradient colors={colors.brandGradient} className="items-center gap-4 p-8" borderRadius={20}>
              <Text variant="h2" className="text-center" style={{ color: colors.onPrimary }}>
                Ready for a fairer household?
              </Text>
              <Button className="bg-white" onPress={() => router.push('/signup')}>
                <Text variant="label" style={{ color: colors.primary }}>{t('landing.getStarted')}</Text>
              </Button>
            </Gradient>
          )}
        </View>

        {/* FOOTER */}
        <View className="w-full max-w-6xl flex-row flex-wrap items-center justify-between gap-3 px-5 pt-8">
          <View className="gap-0.5">
            <Text variant="caption">© {new Date().getFullYear()} {APP_CONFIG.name}</Text>
            <Text variant="caption">Many hands make light work.</Text>
          </View>
          <View className="flex-row gap-5">
            <Link href="/privacy" asChild>
              <Pressable accessibilityRole="link" className="active:opacity-70">
                <Text variant="caption">{t('settings.privacyPolicy')}</Text>
              </Pressable>
            </Link>
            <Link href="/terms" asChild>
              <Pressable accessibilityRole="link" className="active:opacity-70">
                <Text variant="caption">{t('settings.terms')}</Text>
              </Pressable>
            </Link>
          </View>
        </View>
      </ScrollView>
    </View>
  )
}
