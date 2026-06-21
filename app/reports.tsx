import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { Crown, Scale, Sparkles, Star, Trophy } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Progress } from '@/components/ui/progress'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { Sparkline } from '@/components/ui/chart'
import { Section } from '@/components/gallery/kit'
import { useColors } from '@/lib/config/theme'
import { iconFor } from '@/lib/manyhandz/icons'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useReports, type WeeklyReport } from '@/lib/query/hooks/useReports'

/**
 * Weekly Report Card (`/reports`) — the read side of the generate-reports cron. Shows the current
 * week up top + the last 12 as scrollable history. Per member: completion ratio, points, streak,
 * fairness delta, star chore. Family mode is playful (letter grades + MVP crown); roommate mode is
 * clean stats (no grades). `report_data` is loose jsonb the cron owns, so every read is narrowed
 * defensively and we show a friendly empty state until the first report exists.
 */

// --- Defensive jsonb narrowing (the cron owns report_data's shape; never trust a field) ---

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}
function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v : undefined
}

type MemberReport = {
  name: string
  colorKey?: string
  completed?: number
  total?: number
  ratio?: number
  grade?: string
  points?: number
  streak?: number
  fairnessDelta?: number
  starChore?: string
  starChoreIcon?: string
  label?: string
}

/** Pull the per-member rows out of report_data, tolerating array- or object-keyed shapes. */
function memberReports(report: WeeklyReport): MemberReport[] {
  const data = asRecord(report.reportData)
  const raw = Array.isArray(data.members) ? data.members : Object.values(asRecord(data.members))
  return raw.map((m) => {
    const r = asRecord(m)
    const completed = asNum(r.completed) ?? asNum(r.completions)
    const total = asNum(r.total) ?? asNum(r.assigned)
    const ratio =
      asNum(r.ratio) ??
      asNum(r.completionRatio) ??
      (completed !== undefined && total ? completed / total : undefined)
    return {
      name: asStr(r.name) ?? asStr(r.displayName) ?? asStr(r.memberName) ?? 'Member',
      colorKey: asStr(r.color) ?? asStr(r.favoriteColor),
      completed,
      total,
      ratio,
      grade: asStr(r.grade) ?? asStr(r.letterGrade),
      points: asNum(r.points),
      streak: asNum(r.streak) ?? asNum(r.currentStreak),
      fairnessDelta: asNum(r.fairnessDelta) ?? asNum(r.fairness),
      starChore: asStr(r.starChore) ?? asStr(r.topChore),
      starChoreIcon: asStr(r.starChoreIcon) ?? asStr(r.choreIcon),
      label: asStr(r.label),
    }
  })
}

function gradeVariant(grade: string): 'success' | 'default' | 'warning' | 'destructive' {
  const g = grade[0]?.toUpperCase()
  if (g === 'A' || g === 'B') return 'success'
  if (g === 'C') return 'default'
  if (g === 'D') return 'warning'
  return 'destructive'
}

function weekLabel(report: WeeklyReport): string {
  // weekStart/weekEnd are YYYY-MM-DD; render "Jun 9 – Jun 15" defensively (fall back to raw string).
  const fmt = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`)
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }
  return `${fmt(report.weekStart)} – ${fmt(report.weekEnd)}`
}

// --- Per-member row ---

function MemberRow({
  m,
  playful,
  accent,
}: {
  m: MemberReport
  playful: boolean
  accent: string
}) {
  const colors = useColors()
  const pct = m.ratio !== undefined ? Math.round(Math.max(0, Math.min(1, m.ratio)) * 100) : undefined
  const StarIcon = iconFor(m.starChoreIcon)
  const delta = m.fairnessDelta
  const deltaColor =
    delta === undefined
      ? colors.mutedForeground
      : Math.abs(delta) <= 5
        ? colors.success
        : Math.abs(delta) <= 15
          ? colors.warning
          : colors.destructive

  return (
    <View className="gap-2 py-2.5">
      <View className="flex-row items-center gap-3">
        <Avatar name={m.name} size={36} />
        <View className="flex-1">
          <View className="flex-row items-center gap-2">
            <Text variant="label" numberOfLines={1} className="flex-1">
              {m.name}
            </Text>
            {playful && m.grade ? <Badge variant={gradeVariant(m.grade)} label={m.grade} /> : null}
          </View>
          {m.label ? <Text variant="caption">{m.label}</Text> : null}
        </View>
        {m.points !== undefined ? (
          <Text variant="label" style={{ color: accent }}>
            {m.points} pts
          </Text>
        ) : null}
      </View>

      {pct !== undefined ? (
        <View className="gap-1">
          <Progress value={pct} />
          <View className="flex-row items-center justify-between">
            <Text variant="caption">
              {m.completed !== undefined && m.total !== undefined
                ? `${m.completed}/${m.total} chores`
                : 'Completion'}
            </Text>
            <Text variant="caption">{pct}%</Text>
          </View>
        </View>
      ) : null}

      <View className="flex-row flex-wrap items-center gap-x-4 gap-y-1">
        {m.streak !== undefined ? (
          <Text variant="caption">🔥 {m.streak}-day streak</Text>
        ) : null}
        {delta !== undefined ? (
          <View className="flex-row items-center gap-1">
            <Scale color={deltaColor} size={13} />
            <Text variant="caption" style={{ color: deltaColor }}>
              {delta > 0 ? '+' : ''}
              {delta}% fairness
            </Text>
          </View>
        ) : null}
        {m.starChore ? (
          <View className="flex-row items-center gap-1">
            <StarIcon color={accent} size={13} />
            <Text variant="caption" numberOfLines={1}>
              {m.starChore}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  )
}

// --- A single week's card ---

function ReportCard({
  report,
  playful,
  headline,
}: {
  report: WeeklyReport
  playful: boolean
  headline?: boolean
}) {
  const colors = useColors()
  const members = useMemo(() => memberReports(report), [report])
  const accent = colors.brand

  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-center justify-between">
          <View>
            <Text variant={headline ? 'h3' : 'label'}>{weekLabel(report)}</Text>
            {headline ? <Text variant="caption">This week's report card</Text> : null}
          </View>
          {playful && report.mvpMemberName ? (
            <Badge variant="warning">
              <View className="flex-row items-center gap-1">
                <Crown color={colors.foreground} size={12} />
                <Text variant="caption" className="text-black/90">
                  MVP {report.mvpMemberName}
                </Text>
              </View>
            </Badge>
          ) : null}
        </View>

        {members.length === 0 ? (
          <Text variant="muted">No member stats recorded for this week.</Text>
        ) : (
          members.map((m, i) => (
            <View key={`${m.name}-${i}`}>
              {i > 0 ? <View className="h-px bg-border" /> : null}
              <MemberRow m={m} playful={playful} accent={accent} />
            </View>
          ))
        )}
      </CardContent>
    </Card>
  )
}

// --- Fairness trend across the loaded weeks (household-wide, derived defensively) ---

function trendSeries(reports: WeeklyReport[]): number[] {
  // Average completion ratio per week, oldest → newest, for a lightweight sparkline.
  return [...reports]
    .reverse()
    .map((r) => {
      const ms = memberReports(r)
      const ratios = ms.map((m) => m.ratio).filter((v): v is number => v !== undefined)
      if (ratios.length === 0) return undefined
      return Math.round((ratios.reduce((a, b) => a + b, 0) / ratios.length) * 100)
    })
    .filter((v): v is number => v !== undefined)
}

export default function ReportsScreen() {
  const colors = useColors()
  const { orgId, ready, isLoading: modeLoading, features, ui } = useHouseholdMode()
  const reports = useReports(orgId ?? '')
  const [showAll, setShowAll] = useState(false)

  const playful = ui?.tonePlayful ?? false

  // Loading: mode not resolved yet, or the report list is still fetching.
  if (modeLoading || !ready || reports.isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Report Card' }} />
        <PageWrapper className="items-center justify-center" scroll={false}>
          <Spinner size="large" />
        </PageWrapper>
      </>
    )
  }

  // Feature flag off for this mode → friendly gate (weeklyReportCard is on in every shipped mode today).
  if (features && !features.weeklyReportCard) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Report Card' }} />
        <PageWrapper>
          <EmptyState
            icon={Trophy}
            title="Report cards aren't part of this household"
            description="Weekly report cards are turned off for your household's setup."
          />
        </PageWrapper>
      </>
    )
  }

  if (reports.isError) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Report Card' }} />
        <PageWrapper>
          <EmptyState
            icon={Sparkles}
            title="Couldn't load your report cards"
            description="Something went wrong fetching this household's weekly reports. Pull to try again."
          />
        </PageWrapper>
      </>
    )
  }

  const all = reports.data ?? []

  // The cron hasn't generated anything yet → empty state (this is the common first-run case).
  if (all.length === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Report Card' }} />
        <PageWrapper onRefresh={() => reports.refetch()}>
          <EmptyState
            icon={Star}
            title="Your first report card is on its way"
            description="We tally everyone's chores every Sunday. Once your household has a week of activity, the report card lands here."
          />
        </PageWrapper>
      </>
    )
  }

  const [current, ...history] = all
  const trend = trendSeries(all)
  const visibleHistory = showAll ? history : history.slice(0, 4)

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Report Card' }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => reports.refetch()}>
        <Section title="This week">
          <ReportCard report={current} playful={playful} headline />
        </Section>

        {trend.length >= 2 ? (
          <Section title="Completion trend" description="Average chore completion across recent weeks">
            <Card>
              <CardContent className="gap-2">
                <Sparkline data={trend} color={colors.brand} height={56} />
                <View className="flex-row items-center justify-between">
                  <Text variant="caption">{all.length} weeks</Text>
                  <Text variant="caption">{trend[trend.length - 1]}% this week</Text>
                </View>
              </CardContent>
            </Card>
          </Section>
        ) : null}

        {history.length > 0 ? (
          <Section title="Past weeks" description={`Last ${Math.min(history.length, 12)} report cards`}>
            <Accordion>
              {visibleHistory.map((r) => (
                <AccordionItem key={r.id} title={weekLabel(r)}>
                  <ReportCard report={r} playful={playful} />
                </AccordionItem>
              ))}
            </Accordion>
            {!showAll && history.length > 4 ? (
              <Text
                variant="muted"
                className="text-center"
                onPress={() => setShowAll(true)}
              >
                Show {history.length - 4} more weeks
              </Text>
            ) : null}
          </Section>
        ) : null}
      </PageWrapper>
    </>
  )
}
