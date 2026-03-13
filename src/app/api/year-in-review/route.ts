// ============================================================================
// ManyHandz — Year-in-Review Data Generator
// Aggregates a full year of household data into summary statistics.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyHouseholdMembership } from "@/lib/utils/auth-checks";

interface YearInReviewStats {
  year: number;
  totalCompleted: number;
  totalPoints: number;
  mvp: { memberId: string; name: string; points: number } | null;
  mostConsistent: { memberId: string; name: string; longestStreak: number } | null;
  speedDemon: { memberId: string; name: string; avgMinutes: number } | null;
  busiestMonth: { month: string; count: number } | null;
  slowestMonth: { month: string; count: number } | null;
  mostPopularChore: { name: string; count: number } | null;
  mostAvoidedChore: { name: string; overdueCount: number } | null;
  streakRecord: number;
  totalSettlements: number;
  totalSettlementAmount: number;
  memberStats: Array<{
    memberId: string;
    name: string;
    completed: number;
    points: number;
    streak: number;
    wins: number;
    losses: number;
  }>;
  totalCompetitions: number;
  totalChallenges: number;
  totalPollsCreated: number;
  totalGiftsGiven: number;
}

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const householdId = searchParams.get("householdId");
    const year = parseInt(searchParams.get("year") ?? new Date().getFullYear().toString(), 10);

    if (!householdId) {
      return NextResponse.json(
        { error: "householdId required" },
        { status: 400 }
      );
    }

    // Verify user is an active member of this household
    const member = await verifyHouseholdMembership(supabase, user.id, householdId);
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const serviceClient = createServiceClient();

    const yearStart = `${year}-01-01T00:00:00Z`;
    const yearEnd = `${year}-12-31T23:59:59Z`;

    // Fetch all data in parallel
    const [
      { data: members },
      { data: completions },
      { data: assignments },
      { data: competitions },
      { data: challenges },
      { data: settlements },
      { data: chores },
      { data: polls },
      { data: gifts },
    ] = await Promise.all([
      serviceClient
        .from("members")
        .select("id, display_name, current_streak, longest_streak")
        .eq("household_id", householdId),
      serviceClient
        .from("completions")
        .select("id, completed_by, points_earned, speed_bonus, completed_at, actual_minutes, assignment_id, assignments!inner(household_id)")
        .eq("assignments.household_id", householdId)
        .gte("completed_at", yearStart)
        .lte("completed_at", yearEnd)
        .in("status", ["approved", "ai_approved"]),
      serviceClient
        .from("assignments")
        .select("id, chore_id, assigned_to, status, due_date")
        .eq("household_id", householdId)
        .gte("due_date", `${year}-01-01`)
        .lte("due_date", `${year}-12-31`),
      serviceClient
        .from("competitions")
        .select("id, challenger_id, opponent_id, winner_id, status")
        .eq("household_id", householdId)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd),
      serviceClient
        .from("bonus_challenges")
        .select("id")
        .eq("household_id", householdId)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd),
      serviceClient
        .from("settlements")
        .select("id, amount_cents, status")
        .eq("household_id", householdId)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd),
      serviceClient
        .from("chores")
        .select("id, name")
        .eq("household_id", householdId),
      serviceClient
        .from("household_polls")
        .select("id")
        .eq("household_id", householdId)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd),
      serviceClient
        .from("point_gifts")
        .select("id")
        .eq("household_id", householdId)
        .gte("created_at", yearStart)
        .lte("created_at", yearEnd),
    ]);

    const choreMap = new Map((chores ?? []).map((c) => [c.id, c.name]));
    const allMembers = members ?? [];
    const allCompletions = completions ?? [];
    const allAssignments = assignments ?? [];
    const allCompetitions = (competitions ?? []).filter((c) => c.status === "completed");

    // Member stats
    const memberStats = allMembers.map((m) => {
      const memberCompletions = allCompletions.filter(
        (c) => c.completed_by === m.id
      );
      const points = memberCompletions.reduce(
        (sum, c) => sum + (c.points_earned ?? 0) + (c.speed_bonus ?? 0),
        0
      );
      const wins = allCompetitions.filter((c) => c.winner_id === m.id).length;
      const losses = allCompetitions.filter(
        (c) =>
          (c.challenger_id === m.id || c.opponent_id === m.id) &&
          c.winner_id !== m.id &&
          c.winner_id !== null
      ).length;

      return {
        memberId: m.id,
        name: m.display_name,
        completed: memberCompletions.length,
        points,
        streak: m.longest_streak ?? 0,
        wins,
        losses,
      };
    });

    // MVP (most points)
    const mvpMember = memberStats.reduce<(typeof memberStats)[0] | null>(
      (best, m) => (!best || m.points > best.points ? m : best),
      null
    );
    const mvp = mvpMember
      ? { memberId: mvpMember.memberId, name: mvpMember.name, points: mvpMember.points }
      : null;

    // Most consistent (longest streak)
    const consistentMember = memberStats.reduce<(typeof memberStats)[0] | null>(
      (best, m) => (!best || m.streak > best.streak ? m : best),
      null
    );
    const mostConsistent = consistentMember
      ? {
          memberId: consistentMember.memberId,
          name: consistentMember.name,
          longestStreak: consistentMember.streak,
        }
      : null;

    // Speed demon (lowest avg minutes)
    const speedStats = allMembers
      .map((m) => {
        const memberCompletions = allCompletions.filter(
          (c) => c.completed_by === m.id && c.actual_minutes
        );
        if (memberCompletions.length < 3) return null; // need at least 3 completions
        const avg =
          memberCompletions.reduce((sum, c) => sum + (c.actual_minutes ?? 0), 0) /
          memberCompletions.length;
        return { memberId: m.id, name: m.display_name, avgMinutes: Math.round(avg) };
      })
      .filter(Boolean) as { memberId: string; name: string; avgMinutes: number }[];

    const speedDemon = speedStats.reduce<(typeof speedStats)[0] | null>(
      (best, m) => (!best || m.avgMinutes < best.avgMinutes ? m : best),
      null
    );

    // Monthly breakdown
    const monthCounts: Record<string, number> = {};
    for (const c of allCompletions) {
      const month = c.completed_at?.slice(0, 7); // YYYY-MM
      if (month) monthCounts[month] = (monthCounts[month] ?? 0) + 1;
    }

    const monthEntries = Object.entries(monthCounts).sort(
      ([, a], [, b]) => b - a
    );

    const busiestMonth =
      monthEntries.length > 0
        ? { month: monthEntries[0][0], count: monthEntries[0][1] }
        : null;

    const slowestMonth =
      monthEntries.length > 0
        ? {
            month: monthEntries[monthEntries.length - 1][0],
            count: monthEntries[monthEntries.length - 1][1],
          }
        : null;

    // Most popular chore
    const choreCounts: Record<string, number> = {};
    for (const a of allAssignments) {
      if (a.status === "completed") {
        const name = choreMap.get(a.chore_id) ?? "Unknown";
        choreCounts[name] = (choreCounts[name] ?? 0) + 1;
      }
    }
    const popularEntries = Object.entries(choreCounts).sort(
      ([, a], [, b]) => b - a
    );
    const mostPopularChore =
      popularEntries.length > 0
        ? { name: popularEntries[0][0], count: popularEntries[0][1] }
        : null;

    // Most avoided chore
    const overdueCounts: Record<string, number> = {};
    for (const a of allAssignments) {
      if (a.status === "overdue") {
        const name = choreMap.get(a.chore_id) ?? "Unknown";
        overdueCounts[name] = (overdueCounts[name] ?? 0) + 1;
      }
    }
    const avoidedEntries = Object.entries(overdueCounts).sort(
      ([, a], [, b]) => b - a
    );
    const mostAvoidedChore =
      avoidedEntries.length > 0
        ? { name: avoidedEntries[0][0], overdueCount: avoidedEntries[0][1] }
        : null;

    // Streak record
    const streakRecord = Math.max(
      ...allMembers.map((m) => m.longest_streak ?? 0),
      0
    );

    // Settlements
    const settledSettlements = (settlements ?? []).filter(
      (s) => s.status === "settled"
    );
    const totalSettlementAmount = settledSettlements.reduce(
      (sum, s) => sum + (s.amount_cents ?? 0),
      0
    );

    const stats: YearInReviewStats = {
      year,
      totalCompleted: allCompletions.length,
      totalPoints: allCompletions.reduce(
        (sum, c) => sum + (c.points_earned ?? 0) + (c.speed_bonus ?? 0),
        0
      ),
      mvp,
      mostConsistent,
      speedDemon,
      busiestMonth,
      slowestMonth,
      mostPopularChore,
      mostAvoidedChore,
      streakRecord,
      totalSettlements: settledSettlements.length,
      totalSettlementAmount,
      memberStats,
      totalCompetitions: allCompetitions.length,
      totalChallenges: (challenges ?? []).length,
      totalPollsCreated: (polls ?? []).length,
      totalGiftsGiven: (gifts ?? []).length,
    };

    return NextResponse.json({ success: true, stats });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
