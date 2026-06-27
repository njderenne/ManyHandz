import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import Svg, { Circle } from 'react-native-svg'
import { Scale, Users, Flame } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Table, type TableColumn } from '@/components/ui/table'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { TierGate } from '@/components/ui/tier-gate'
import { useColors, type Palette } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHouseholdMembers, type HouseholdMember } from '@/lib/query/hooks/useHousehold'
import { useFairness, type FairnessPeriod } from '@/lib/query/hooks/useFairness'
import { accentHex } from '@/lib/manyhandz/accents'
import {
  fairnessLabel,
  type FairnessStatus,
  type MemberFairness,
} from '@/lib/manyhandz/fairness'

/**
 * Fairness — the roommate hero (and a universal feature: `fairnessScoring` is true in every mode).
 * A large balance gauge for the WHOLE household, a period selector, per-member effort rings + bars
 * colored by each member's accent, and a stats table. READ-only: everyone sees the same balance,
 * so there's no write affordance to gate. Top-level nav tab → header hidden (the product nav owns
 * the top bar); the screen renders its own heading.
 */

// `useFairness(orgId, period)` returns FairnessResponse; the period selector here offers the four
// week/month windows (the hook also accepts `all_time`, which this screen doesn't surface).
type Period = Extract<FairnessPeriod, 'this_week' | 'last_week' | 'this_month' | 'last_month'>

const PERIOD_OPTIONS = [
  { label: 'This week', value: 'this_week' },
  { label: 'Last week', value: 'last_week' },
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
]

/** Household balance score → a semantic theme color (never a raw hex — keeps the theme-guard happy). */
function scoreColor(score: number, colors: Palette): string {
  if (score >= 75) return colors.success
  if (score >= 60) return colors.brand
  if (score >= 40) return colors.warning
  return colors.destructive
}

/** Per-member deviation status → a Badge variant + copy. */
const STATUS_META: Record<FairnessStatus, { variant: BadgeProps['variant']; label: string }> = {
  balanced: { variant: 'success', label: 'Balanced' },
  slightly_off: { variant: 'warning', label: 'Slightly off' },
  significantly_off: { variant: 'destructive', label: 'Off balance' },
}

const fmtPct = (n: number) => `${Math.round(n)}%`
const fmtSigned = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n)}%`

/**
 * The household balance gauge — a determinate SVG ring colored by band. CircularProgress is hard-
 * wired to the primary color; fairness needs the score's band color, so this small inline ring
 * mirrors its geometry while taking a `color`.
 */
function BalanceGauge({ score, color }: { score: number; color: string }) {
  const colors = useColors()
  const size = 176
  const strokeWidth = 14
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const pct = Math.max(0, Math.min(100, score))
  return (
    <View style={{ width: size, height: size }} className="items-center justify-center">
      <Svg width={size} height={size} style={{ position: 'absolute', transform: [{ rotate: '-90deg' }] }}>
        <Circle cx={size / 2} cy={size / 2} r={radius} stroke={colors.border} strokeWidth={strokeWidth} fill="none" />
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={color}
          strokeWidth={strokeWidth}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct / 100)}
        />
      </Svg>
      <Text variant="h1" className="tabular-nums" style={{ color }}>
        {Math.round(pct)}
      </Text>
      <Text variant="caption">out of 100</Text>
    </View>
  )
}

export default function FairnessScreen() {
  const colors = useColors()
  const { orgId, ready, features, isLoading } = useHouseholdMode()
  const [period, setPeriod] = useState<Period>('this_week')

  const fairnessQuery = useFairness(orgId ?? '', period)
  const membersQuery = useHouseholdMembers(orgId ?? '')

  const data = fairnessQuery.data
  const result = data?.fairness
  const memberNames = data?.memberNames ?? {}

  // Accent + display-name lookup from the members roster (the fairness payload carries names but not
  // colors). Resolve each member's stored accent KEY to a hex via accentHex().
  const metaById = useMemo(() => {
    const map = new Map<string, HouseholdMember>()
    for (const m of membersQuery.data ?? []) map.set(m.memberId, m)
    return map
  }, [membersQuery.data])

  const sorted = useMemo(
    () => [...(result?.perMember ?? [])].sort((a, b) => b.percentage - a.percentage),
    [result],
  )
  const maxPercentage = sorted.reduce((max, m) => Math.max(max, m.percentage), 0)

  const nameFor = (memberId: string) =>
    metaById.get(memberId)?.displayName ?? memberNames[memberId] ?? 'Member'
  const accentFor = (memberId: string) => accentHex(metaById.get(memberId)?.favoriteColor)

  const tableColumns: TableColumn[] = [
    { key: 'name', header: 'Member' },
    {
      key: 'points',
      header: 'Effort',
      align: 'right',
      render: (row) => <Text className="text-right tabular-nums">{String(row.points)}</Text>,
    },
    {
      key: 'percentage',
      header: 'Share',
      align: 'right',
      render: (row) => <Text className="text-right tabular-nums">{fmtPct(Number(row.percentage))}</Text>,
    },
    {
      key: 'deviation',
      header: 'vs. fair',
      align: 'right',
      render: (row) => <Text className="text-right tabular-nums">{fmtSigned(Number(row.deviation))}</Text>,
    },
  ]
  const tableData = sorted.map((m) => ({
    name: nameFor(m.memberId),
    points: m.points,
    percentage: m.percentage,
    deviation: m.deviation,
  }))

  return (
    <>
      <Stack.Screen options={{ headerShown: false, title: 'Fairness' }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => fairnessQuery.refetch()}>
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Scale size={22} color={colors.brand} />
            <Text variant="h1">Fairness</Text>
          </View>
          <Text variant="muted">Effort-weighted balance across your household — a hard 40-minute chore counts for more than a quick one.</Text>
        </View>

        {isLoading || !ready ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !features?.fairnessScoring ? (
          // Belt-and-braces: fairnessScoring is true in every mode, but if a future mode turns it
          // off this screen degrades to a friendly empty state instead of a broken page.
          <EmptyState
            icon={Scale}
            title="Fairness isn't available here"
            description="This household's mode doesn't track effort balance."
            action={<Button label="Back home" variant="outline" onPress={() => router.replace('/')} />}
          />
        ) : (
          // Paid (Premium): the fairness / effort-balance report. TierGate shows its default
          // UpgradePrompt to non-entitled orgs; the Worker (worker/routes/fairness.ts) is the real
          // gate (the query 402s without entitlement).
          <TierGate min="STANDARD">
            <SegmentedControl
              value={period}
              onValueChange={(v) => setPeriod(v as Period)}
              options={PERIOD_OPTIONS}
            />

            <AsyncBoundary
              query={fairnessQuery}
              isEmpty={ready && !fairnessQuery.isLoading && sorted.length === 0}
              empty={
                <EmptyState
                  icon={Users}
                  title="No one to compare yet"
                  description="Once household members start completing chores in this period, their effort balance shows up here."
                />
              }
            >
              {result ? (
                <>
                  {/* Hero: household balance gauge + label, colored by band. */}
                  <Card>
                    <CardContent className="items-center gap-3 py-6">
                      <Text variant="caption" className="uppercase tracking-wider">Household balance</Text>
                      <BalanceGauge score={result.householdScore} color={scoreColor(result.householdScore, colors)} />
                      <Text variant="h3" style={{ color: scoreColor(result.householdScore, colors) }}>
                        {result.label || fairnessLabel(result.householdScore)}
                      </Text>
                      <View className="flex-row items-center gap-1.5">
                        <Flame size={16} color={colors.warning} />
                        <Text variant="muted">
                          {data?.zeroOverdueStreakDays ?? 0}-day zero-overdue streak · {data?.activeMemberCount ?? sorted.length} active
                        </Text>
                      </View>
                    </CardContent>
                  </Card>

                  {/* Per-member contribution rings/bars, each colored by the member's accent. */}
                  <Card>
                    <CardContent className="gap-4">
                      <Text variant="label">Contribution by member</Text>
                      {sorted.map((m) => (
                        <MemberContributionRow
                          key={m.memberId}
                          member={m}
                          name={nameFor(m.memberId)}
                          accent={accentFor(m.memberId)}
                          avatarUri={metaById.get(m.memberId)?.avatarUrl ?? undefined}
                          maxPercentage={maxPercentage}
                        />
                      ))}
                    </CardContent>
                  </Card>

                  {/* Stacked share bar — the contribution "pie", but a web-safe stacked bar so it
                      needs no Skia/CanvasKit and keeps every member's accent color. */}
                  <Card>
                    <CardContent className="gap-3">
                      <Text variant="label">Share of total effort</Text>
                      <View className="h-4 flex-row overflow-hidden rounded-full" style={{ backgroundColor: colors.accent }}>
                        {sorted
                          .filter((m) => m.percentage > 0)
                          .map((m) => (
                            <View
                              key={m.memberId}
                              style={{ width: `${m.percentage}%`, backgroundColor: accentFor(m.memberId) }}
                              accessibilityLabel={`${nameFor(m.memberId)} ${fmtPct(m.percentage)}`}
                            />
                          ))}
                      </View>
                      <View className="flex-row flex-wrap gap-x-4 gap-y-1.5">
                        {sorted.map((m) => (
                          <View key={m.memberId} className="flex-row items-center gap-1.5">
                            <View className="size-3 rounded-full" style={{ backgroundColor: accentFor(m.memberId) }} />
                            <Text variant="caption">{nameFor(m.memberId)} · {fmtPct(m.percentage)}</Text>
                          </View>
                        ))}
                      </View>
                    </CardContent>
                  </Card>

                  {/* Detailed stats table. */}
                  <View className="gap-2">
                    <Text variant="label">Breakdown</Text>
                    <Table columns={tableColumns} data={tableData} />
                  </View>
                </>
              ) : null}
            </AsyncBoundary>
          </TierGate>
        )}
      </PageWrapper>
    </>
  )
}

/** One member's effort row: accent avatar ring + a proportional bar colored by their accent. */
function MemberContributionRow({
  member,
  name,
  accent,
  avatarUri,
  maxPercentage,
}: {
  member: MemberFairness
  name: string
  accent: string
  avatarUri?: string
  maxPercentage: number
}) {
  const colors = useColors()
  const status = STATUS_META[member.status]
  const barWidth = maxPercentage > 0 ? (member.percentage / maxPercentage) * 100 : 0
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-3">
        <View className="rounded-full p-0.5" style={{ borderWidth: 2, borderColor: accent }}>
          <Avatar name={name} uri={avatarUri} size={30} />
        </View>
        <View className="flex-1">
          <Text variant="label" numberOfLines={1}>
            {name}
          </Text>
          <Text variant="caption">
            {member.points} pts · {fmtSigned(member.deviation)} vs. fair share
          </Text>
        </View>
        <Badge variant={status.variant} label={status.label} />
      </View>
      <View className="h-2.5 overflow-hidden rounded-full" style={{ backgroundColor: colors.accent }}>
        <View
          className="h-full rounded-full"
          style={{ width: `${Math.max(2, barWidth)}%`, backgroundColor: accent }}
          accessibilityLabel={`${name} ${fmtPct(member.percentage)} of household effort`}
        />
      </View>
    </View>
  )
}
