"use client";

import { useState, useMemo } from "react";
import dynamic from "next/dynamic";
import { useQuery } from "@tanstack/react-query";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subWeeks,
  subMonths,
  format,
  parseISO,
  isWithinInterval,
} from "date-fns";
import {
  Scale,
  TrendingUp,
  Flame,
  AlertTriangle,
  BarChart3,
  PieChart as PieChartIcon,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import {
  calculateFairnessScores,
  getHouseholdFairnessScore,
  getFairnessColor,
  type FairnessScore as FairnessScoreType,
} from "@/lib/utils/fairness";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";

import { FairnessScore } from "@/components/fairness/fairness-score";
import { BalanceMeter } from "@/components/fairness/balance-meter";

// Lazy-load Recharts-based components — keeps recharts out of the initial bundle
const ContributionChart = dynamic(
  () => import("@/components/fairness/contribution-chart").then((m) => m.ContributionChart),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[250px] w-full rounded-xl" />,
  }
);

const TrendLine = dynamic(
  () => import("@/components/fairness/trend-line").then((m) => m.TrendLine),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[250px] w-full rounded-xl" />,
  }
);

import type { Member, Assignment } from "@/lib/supabase/types";

/** Assignment with joined chore name from Supabase */
type AssignmentWithChore = Assignment & { chores: { id: string; name: string } | null };

type PeriodKey =
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "custom";

function getDateRange(period: PeriodKey): { start: Date; end: Date } {
  const now = new Date();
  switch (period) {
    case "this_week":
      return { start: startOfWeek(now, { weekStartsOn: 1 }), end: endOfWeek(now, { weekStartsOn: 1 }) };
    case "last_week": {
      const lw = subWeeks(now, 1);
      return { start: startOfWeek(lw, { weekStartsOn: 1 }), end: endOfWeek(lw, { weekStartsOn: 1 }) };
    }
    case "this_month":
      return { start: startOfMonth(now), end: endOfMonth(now) };
    case "last_month": {
      const lm = subMonths(now, 1);
      return { start: startOfMonth(lm), end: endOfMonth(lm) };
    }
    default:
      return { start: startOfMonth(now), end: endOfMonth(now) };
  }
}

export default function FairnessPage() {
  const [period, setPeriod] = useState<PeriodKey>("this_week");
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { members, isLoading: membersLoading } = useMembers();
  const { features } = useHouseholdMode();

  const supabase = createClient();
  const dateRange = useMemo(() => getDateRange(period), [period]);

  // Fetch completions for the selected period
  const { data: completions = [], isLoading: completionsLoading } = useQuery({
    queryKey: ["fairness-completions", householdId, period],
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("completions")
        .select("id, completed_by, points_earned, speed_bonus, completed_at, status, assignments!inner(id, household_id)")
        .eq("assignments.household_id", householdId)
        .gte("completed_at", dateRange.start.toISOString())
        .lte("completed_at", dateRange.end.toISOString())
        .in("status", ["approved", "ai_approved"]);
      return data || [];
    },
    enabled: !!householdId,
  });

  // Fetch all completions for trend data (past 8 weeks)
  const { data: trendCompletions = [] } = useQuery({
    queryKey: ["fairness-trend", householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const eightWeeksAgo = subWeeks(new Date(), 8);
      const { data } = await supabase
        .from("completions")
        .select("id, completed_by, points_earned, speed_bonus, completed_at, status, assignments!inner(id, household_id)")
        .eq("assignments.household_id", householdId)
        .gte("completed_at", eightWeeksAgo.toISOString())
        .in("status", ["approved", "ai_approved"]);
      return data || [];
    },
    enabled: !!householdId,
  });

  // Fetch assignments for "most avoided" and overdue streak (scoped to last 90 days)
  const assignmentsCutoff = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d.toISOString().split("T")[0];
  }, []);

  const { data: assignments = [] } = useQuery({
    queryKey: ["fairness-assignments", householdId, assignmentsCutoff],
    queryFn: async () => {
      if (!householdId) return [] as AssignmentWithChore[];
      const PAGE_SIZE = 200;
      let allAssignments: AssignmentWithChore[] = [];
      let page = 0;
      let hasMore = true;

      while (hasMore) {
        const { data: pageData } = await supabase
          .from("assignments")
          .select("id, chore_id, assigned_to, due_date, status, chores(id, name)")
          .eq("household_id", householdId)
          .gte("due_date", assignmentsCutoff)
          .order("due_date", { ascending: false })
          .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

        const rows = (pageData || []) as unknown as AssignmentWithChore[];
        allAssignments = [...allAssignments, ...rows];
        hasMore = rows.length === PAGE_SIZE;
        page++;
      }

      return allAssignments;
    },
    enabled: !!householdId,
    staleTime: 2 * 60 * 1000, // 2 minutes — assignment data changes infrequently
  });

  // Build member points from completions
  const memberPoints = useMemo(() => {
    const pointMap: Record<string, number> = {};
    for (const c of completions) {
      const id = c.completed_by;
      pointMap[id] = (pointMap[id] || 0) + (c.points_earned || 0) + (c.speed_bonus || 0);
    }
    return members.map((m) => ({
      memberId: m.id,
      points: pointMap[m.id] || 0,
    }));
  }, [completions, members]);

  const fairnessScores = useMemo(
    () => calculateFairnessScores(memberPoints),
    [memberPoints]
  );

  const householdScore = useMemo(
    () => getHouseholdFairnessScore(memberPoints),
    [memberPoints]
  );

  // Count completions per member for the stats table
  const completionCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of completions) {
      map[c.completed_by] = (map[c.completed_by] || 0) + 1;
    }
    return map;
  }, [completions]);

  // Build trend data (past 8 weeks)
  const trendData = useMemo(() => {
    const weeks: Array<{ start: Date; end: Date; label: string }> = [];
    const now = new Date();
    for (let i = 7; i >= 0; i--) {
      const ws = startOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      const we = endOfWeek(subWeeks(now, i), { weekStartsOn: 1 });
      weeks.push({
        start: ws,
        end: we,
        label: format(ws, "MMM d"),
      });
    }

    return weeks.map((week) => {
      const weekCompletions = trendCompletions.filter((c: any) => {
        const d = parseISO(c.completed_at);
        return isWithinInterval(d, { start: week.start, end: week.end });
      });

      const weekMemberPoints = members.map((m) => ({
        memberId: m.id,
        points: weekCompletions
          .filter((c: any) => c.completed_by === m.id)
          .reduce((sum: number, c: any) => sum + (c.points_earned || 0) + (c.speed_bonus || 0), 0),
      }));

      const weekScores = calculateFairnessScores(weekMemberPoints);
      const dataPoint: { week: string; [memberId: string]: number | string } = { week: week.label };
      for (const score of weekScores) {
        dataPoint[score.memberId] = score.percentage;
      }
      return dataPoint;
    });
  }, [trendCompletions, members]);

  // Most avoided chores (skipped or overdue most often)
  const mostAvoided = useMemo(() => {
    const choreSkipCount: Record<string, { name: string; count: number }> = {};
    for (const a of assignments) {
      if (a.status === "overdue" || a.status === "skipped") {
        const choreName = (a as AssignmentWithChore).chores?.name || "Unknown";
        const choreId = a.chore_id;
        if (!choreSkipCount[choreId]) {
          choreSkipCount[choreId] = { name: choreName, count: 0 };
        }
        choreSkipCount[choreId].count++;
      }
    }
    return Object.values(choreSkipCount)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [assignments]);

  // Household streak: consecutive days with zero overdue
  const householdStreak = useMemo(() => {
    if (assignments.length === 0) return 0;

    // Find the earliest due date so we don't count days before the household had assignments
    const dueDates = assignments
      .map((a) => a.due_date)
      .filter(Boolean)
      .sort();
    const earliestDueDate = dueDates.length > 0 ? dueDates[0] : null;
    if (!earliestDueDate) return 0;

    const now = new Date();
    let streak = 0;

    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(now);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = format(checkDate, "yyyy-MM-dd");

      // Stop counting before the household had any assignments
      if (dateStr < earliestDueDate) break;

      const overdueOnDay = assignments.some(
        (a) => a.due_date === dateStr && a.status === "overdue"
      );

      if (overdueOnDay) break;
      streak++;
    }

    return streak;
  }, [assignments]);

  const isLoading = membersLoading || completionsLoading;

  const memberMap = useMemo(() => {
    const map: Record<string, Member> = {};
    for (const m of members) {
      map[m.id] = m;
    }
    return map;
  }, [members]);

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-36" />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-48 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Scale className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Fairness</h1>
          <Badge variant="outline" className="hidden sm:inline-flex">
            {householdScore.label}
          </Badge>
        </div>
        <Select
          value={period}
          onValueChange={(v) => setPeriod(v as PeriodKey)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Select period" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="this_week">This Week</SelectItem>
            <SelectItem value="last_week">Last Week</SelectItem>
            <SelectItem value="this_month">This Month</SelectItem>
            <SelectItem value="last_month">Last Month</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Household score + streak */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Card>
          <CardContent className="flex items-center gap-4">
            <div
              className="flex items-center justify-center h-16 w-16 rounded-full text-2xl font-bold"
              style={{
                backgroundColor:
                  householdScore.score >= 75
                    ? "rgba(52,211,153,0.15)"
                    : householdScore.score >= 50
                    ? "rgba(251,191,36,0.15)"
                    : "rgba(248,113,113,0.15)",
                color:
                  householdScore.score >= 75
                    ? "#34d399"
                    : householdScore.score >= 50
                    ? "#fbbf24"
                    : "#f87171",
              }}
            >
              {householdScore.score}
            </div>
            <div>
              <p className="font-semibold text-lg">Household Balance</p>
              <p className="text-sm text-muted-foreground">
                {householdScore.label}
              </p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4">
            <div className="flex items-center justify-center h-16 w-16 rounded-full bg-orange-500/15 text-orange-400">
              <Flame className="h-8 w-8" />
            </div>
            <div>
              <p className="font-semibold text-lg">
                {householdStreak} day{householdStreak !== 1 ? "s" : ""}
              </p>
              <p className="text-sm text-muted-foreground">
                Zero-overdue streak
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Individual fairness gauges */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4" />
            Member Fairness Scores
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap justify-center gap-8">
            {fairnessScores.map((score) => {
              const member = memberMap[score.memberId];
              if (!member) return null;
              return (
                <FairnessScore
                  key={score.memberId}
                  memberId={score.memberId}
                  memberName={member.display_name}
                  avatarUrl={member.avatar_url}
                  percentage={score.percentage}
                  status={score.status}
                  favoriteColor={member.favorite_color}
                />
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Balance Meter */}
      <Card>
        <CardHeader>
          <CardTitle>Household Balance</CardTitle>
        </CardHeader>
        <CardContent>
          <BalanceMeter
            members={fairnessScores.map((score) => ({
              memberId: score.memberId,
              memberName:
                memberMap[score.memberId]?.display_name || "Unknown",
              percentage: score.percentage,
              color: getFairnessColor(score.percentage, members.length),
            }))}
          />
        </CardContent>
      </Card>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Contribution pie chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PieChartIcon className="h-4 w-4" />
              Contribution Breakdown
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ContributionChart
              members={fairnessScores.map((score) => ({
                memberId: score.memberId,
                memberName:
                  memberMap[score.memberId]?.display_name || "Unknown",
                points: score.points,
                color:
                  memberMap[score.memberId]?.favorite_color || "#6366f1",
              }))}
            />
          </CardContent>
        </Card>

        {/* Trend line chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Weekly Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <TrendLine
              data={trendData}
              members={members.map((m) => ({
                memberId: m.id,
                memberName: m.display_name,
                color: m.favorite_color,
              }))}
            />
          </CardContent>
        </Card>
      </div>

      {/* Detailed stats table */}
      <Card>
        <CardHeader>
          <CardTitle>Detailed Stats</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-4">Member</th>
                  <th className="text-right py-2 px-4">Completed</th>
                  <th className="text-right py-2 px-4">Points</th>
                  <th className="text-right py-2 px-4">Share</th>
                  <th className="text-right py-2 pl-4">Deviation</th>
                </tr>
              </thead>
              <tbody>
                {fairnessScores.map((score) => {
                  const member = memberMap[score.memberId];
                  if (!member) return null;
                  return (
                    <tr key={score.memberId} className="border-b border-border/50">
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: member.favorite_color }}
                          />
                          <span className="font-medium">{member.display_name}</span>
                        </div>
                      </td>
                      <td className="text-right py-3 px-4">
                        {completionCounts[score.memberId] || 0}
                      </td>
                      <td className="text-right py-3 px-4">{score.points}</td>
                      <td className="text-right py-3 px-4">
                        {Math.round(score.percentage)}%
                      </td>
                      <td className="text-right py-3 pl-4">
                        <span
                          className={cn(
                            "font-medium",
                            score.status === "balanced" && "text-emerald-400",
                            score.status === "slightly_off" && "text-amber-400",
                            score.status === "significantly_off" && "text-red-400"
                          )}
                        >
                          {score.deviation > 0 ? "+" : ""}
                          {Math.round(score.deviation)}pp
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Most avoided chores */}
      {mostAvoided.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-400" />
              Most Avoided Chores
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {mostAvoided.map((chore, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between py-2 border-b border-border/50 last:border-0"
                >
                  <span className="font-medium">{chore.name}</span>
                  <Badge variant="destructive">
                    {chore.count} skip{chore.count !== 1 ? "s" : ""}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
