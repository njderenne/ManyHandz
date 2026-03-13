"use client";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import type { WeeklyReport } from "@/lib/supabase/types";
import { startOfWeek, endOfWeek, subWeeks, format } from "date-fns";

export type WeeklyReportWithMVP = WeeklyReport & {
  mvp_member?: Record<string, unknown> | null;
};

/** Shape of per-member data stored in report_data */
export interface MemberReportData {
  member_id: string;
  display_name: string;
  avatar_url: string | null;
  favorite_color: string;
  completions: number;
  total_assigned: number;
  completion_ratio: number;
  letter_grade: string;
  points_earned: number;
  current_streak: number;
  fairness_delta: number;
  star_chore: string | null;
  labels: string[];
}

/** Shape of household summary in report_data */
export interface HouseholdReportSummary {
  total_completed: number;
  total_assigned: number;
  household_streak: number;
  mvp_member_id: string | null;
  milestones: string[];
  members: MemberReportData[];
}

export function useReports() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);

  const { data: reports = [], isLoading } = useQuery({
    queryKey: ["weekly-reports", householdId],
    staleTime: 10 * 60 * 1000, // 10 minutes — reports generated weekly
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("weekly_reports")
        .select("*, mvp_member:members!mvp_member_id(*)")
        .eq("household_id", householdId)
        .order("week_start", { ascending: false })
        .limit(12);
      return (data || []) as WeeklyReportWithMVP[];
    },
    enabled: !!householdId,
  });

  const currentWeekReport = reports.length > 0 ? reports[0] : null;
  const previousReports = reports.slice(1);

  return {
    reports,
    currentWeekReport,
    previousReports,
    isLoading,
  };
}

/** Compute the current week's boundaries */
export function getCurrentWeekRange() {
  const now = new Date();
  const weekStart = startOfWeek(now, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 });
  return {
    start: format(weekStart, "yyyy-MM-dd"),
    end: format(weekEnd, "yyyy-MM-dd"),
    label: `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`,
  };
}

/** Compute a past week's boundaries */
export function getWeekRange(weeksAgo: number) {
  const now = new Date();
  const target = subWeeks(now, weeksAgo);
  const weekStart = startOfWeek(target, { weekStartsOn: 1 });
  const weekEnd = endOfWeek(target, { weekStartsOn: 1 });
  return {
    start: format(weekStart, "yyyy-MM-dd"),
    end: format(weekEnd, "yyyy-MM-dd"),
    label: `${format(weekStart, "MMM d")} - ${format(weekEnd, "MMM d, yyyy")}`,
  };
}

/** Map completion ratio to letter grade */
export function getLetterGrade(ratio: number): string {
  if (ratio >= 0.97) return "A+";
  if (ratio >= 0.93) return "A";
  if (ratio >= 0.9) return "A-";
  if (ratio >= 0.87) return "B+";
  if (ratio >= 0.83) return "B";
  if (ratio >= 0.8) return "B-";
  if (ratio >= 0.77) return "C+";
  if (ratio >= 0.73) return "C";
  if (ratio >= 0.7) return "C-";
  if (ratio >= 0.67) return "D+";
  if (ratio >= 0.63) return "D";
  if (ratio >= 0.6) return "D-";
  return "F";
}

/** Color class for a letter grade */
export function getGradeColor(grade: string): string {
  if (grade.startsWith("A")) return "text-emerald-400";
  if (grade.startsWith("B")) return "text-blue-400";
  if (grade.startsWith("C")) return "text-amber-400";
  if (grade.startsWith("D")) return "text-orange-400";
  return "text-red-400";
}

/** Background class for a letter grade */
export function getGradeBgColor(grade: string): string {
  if (grade.startsWith("A")) return "bg-emerald-400/10";
  if (grade.startsWith("B")) return "bg-blue-400/10";
  if (grade.startsWith("C")) return "bg-amber-400/10";
  if (grade.startsWith("D")) return "bg-orange-400/10";
  return "bg-red-400/10";
}
