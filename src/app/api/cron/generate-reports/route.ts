// ============================================================================
// ManyHandz — Cron: Generate Weekly Reports
// Weekly (Sunday): comprehensive report generation for each household.
//
// For each household with an active subscription:
//   a. Calculate per-member stats (completions, points, streak, fairness)
//   b. Assign letter grades (A+ through F based on completion rate)
//   c. Pick MVP (most points this week)
//   d. Generate report_data JSON
//   e. Insert weekly_reports row
//   f. Check allowance eligibility → create settlements
//   g. Recalculate household health_score
//   h. Check recurring shopping items → auto-add
//   i. Auto-close expired polls
// ============================================================================

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import {
  calculateFairnessScores,
  getHouseholdFairnessScore,
} from "@/lib/utils/fairness";

// ---------------------------------------------------------------------------
// Letter grade assignment based on completion rate percentage
// ---------------------------------------------------------------------------

function getLetterGrade(completionRate: number): string {
  if (completionRate >= 97) return "A+";
  if (completionRate >= 93) return "A";
  if (completionRate >= 90) return "A-";
  if (completionRate >= 87) return "B+";
  if (completionRate >= 83) return "B";
  if (completionRate >= 80) return "B-";
  if (completionRate >= 77) return "C+";
  if (completionRate >= 73) return "C";
  if (completionRate >= 70) return "C-";
  if (completionRate >= 67) return "D+";
  if (completionRate >= 63) return "D";
  if (completionRate >= 60) return "D-";
  return "F";
}

export async function POST(request: Request) {
  // Double-check cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const now = new Date();

    // Calculate week boundaries (Sunday to Saturday)
    const weekEnd = new Date(now);
    weekEnd.setHours(23, 59, 59, 999);
    const weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    const weekStartStr = weekStart.toISOString().split("T")[0];
    const weekEndStr = weekEnd.toISOString().split("T")[0];

    // 1. Get all households with active subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from("subscriptions")
      .select("household_id")
      .in("status", ["active", "trialing"]);

    if (subError) throw subError;

    if (!subscriptions?.length) {
      return NextResponse.json({
        success: true,
        householdsProcessed: 0,
        message: "No active subscriptions",
      });
    }

    const householdIds = [...new Set(subscriptions.map((s) => s.household_id))];
    let householdsProcessed = 0;

    for (const householdId of householdIds) {
      try {
        // --- a. Get all active members of this household ---
        const { data: members } = await supabase
          .from("members")
          .select("id, display_name, role, current_streak, longest_streak, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_reward_description, allowance_threshold_pct")
          .eq("household_id", householdId)
          .eq("is_active", true);

        if (!members?.length) continue;

        // --- Get assignments for this week ---
        const { data: weekAssignments } = await supabase
          .from("assignments")
          .select("id, assigned_to, status, chore_id")
          .eq("household_id", householdId)
          .gte("due_date", weekStartStr)
          .lte("due_date", weekEndStr);

        const assignments = weekAssignments || [];

        // --- Get completions for this week (scoped to household) ---
        const { data: weekCompletions } = await supabase
          .from("completions")
          .select("id, completed_by, points_earned, speed_bonus, completed_at, assignments!inner(household_id)")
          .eq("assignments.household_id", householdId)
          .gte("completed_at", weekStart.toISOString())
          .lte("completed_at", weekEnd.toISOString())
          .in("status", ["approved", "ai_approved"]);

        const completions = weekCompletions || [];

        // --- b. Calculate per-member stats ---
        interface MemberReport {
          memberId: string;
          displayName: string;
          totalAssigned: number;
          completed: number;
          overdue: number;
          completionRate: number;
          pointsEarned: number;
          currentStreak: number;
          longestStreak: number;
          grade: string;
        }

        const memberReports: MemberReport[] = members.map((member) => {
          const memberAssignments = assignments.filter(
            (a) => a.assigned_to === member.id
          );
          const totalAssigned = memberAssignments.length;
          const completed = memberAssignments.filter(
            (a) => a.status === "completed"
          ).length;
          const overdue = memberAssignments.filter(
            (a) => a.status === "overdue"
          ).length;

          const completionRate =
            totalAssigned > 0 ? (completed / totalAssigned) * 100 : 100;

          const memberCompletions = completions.filter(
            (c) => c.completed_by === member.id
          );
          const pointsEarned = memberCompletions.reduce(
            (sum, c) => sum + (c.points_earned || 0) + (c.speed_bonus || 0),
            0
          );

          const grade = getLetterGrade(completionRate);

          return {
            memberId: member.id,
            displayName: member.display_name,
            totalAssigned,
            completed,
            overdue,
            completionRate: Math.round(completionRate * 10) / 10,
            pointsEarned,
            currentStreak: member.current_streak,
            longestStreak: member.longest_streak,
            grade,
          };
        });

        // --- c. Determine MVP (most points this week) ---
        const mvp = memberReports.reduce(
          (best, current) =>
            current.pointsEarned > best.pointsEarned ? current : best,
          memberReports[0]
        );
        const mvpMemberId =
          mvp.pointsEarned > 0 ? mvp.memberId : null;

        // --- Fairness scores ---
        const memberPoints = memberReports.map((m) => ({
          memberId: m.memberId,
          points: m.pointsEarned,
        }));
        const fairnessScores = calculateFairnessScores(memberPoints);
        const householdFairness = getHouseholdFairnessScore(memberPoints);

        // --- Household-level stats ---
        const totalAssignments = assignments.length;
        const totalCompleted = assignments.filter(
          (a) => a.status === "completed"
        ).length;
        const totalOverdue = assignments.filter(
          (a) => a.status === "overdue"
        ).length;
        const householdCompletionRate =
          totalAssignments > 0
            ? Math.round((totalCompleted / totalAssignments) * 1000) / 10
            : 100;

        // --- d. Generate report_data JSON ---
        const reportData = {
          weekStart: weekStartStr,
          weekEnd: weekEndStr,
          household: {
            totalAssignments,
            totalCompleted,
            totalOverdue,
            completionRate: householdCompletionRate,
            fairnessScore: householdFairness.score,
            fairnessLabel: householdFairness.label,
          },
          members: memberReports,
          fairness: fairnessScores.map((f) => ({
            memberId: f.memberId,
            percentage: Math.round(f.percentage * 10) / 10,
            deviation: Math.round(f.deviation * 10) / 10,
            status: f.status,
          })),
          mvp: mvpMemberId
            ? {
                memberId: mvp.memberId,
                displayName: mvp.displayName,
                pointsEarned: mvp.pointsEarned,
              }
            : null,
        };

        // --- e. Insert weekly_reports row ---
        // Check for existing report to avoid duplicates
        const { data: existingReport } = await supabase
          .from("weekly_reports")
          .select("id")
          .eq("household_id", householdId)
          .eq("week_start", weekStartStr)
          .eq("week_end", weekEndStr)
          .limit(1);

        if (existingReport && existingReport.length > 0) {
          // Update existing report
          await supabase
            .from("weekly_reports")
            .update({
              report_data: reportData,
              mvp_member_id: mvpMemberId,
            })
            .eq("id", existingReport[0].id);
        } else {
          // Insert new report
          const { error: reportError } = await supabase
            .from("weekly_reports")
            .insert({
              household_id: householdId,
              week_start: weekStartStr,
              week_end: weekEndStr,
              report_data: reportData,
              mvp_member_id: mvpMemberId,
            });

          if (reportError) {
            console.error(
              `Failed to insert weekly report for household ${householdId}:`,
              reportError
            );
          }
        }

        // --- f. Check allowance eligibility → create settlements ---
        for (const member of members) {
          if (!member.allowance_enabled) continue;
          if (member.allowance_amount_cents <= 0) continue;

          const report = memberReports.find((r) => r.memberId === member.id);
          if (!report) continue;

          // Check if completion rate meets threshold
          const threshold = member.allowance_threshold_pct || 80;
          if (report.completionRate < threshold) continue;

          // Idempotency: skip if an allowance settlement already exists for
          // this member during the current report week
          const { count: existingAllowanceCount } = await supabase
            .from("settlements")
            .select("id", { count: "exact", head: true })
            .eq("household_id", householdId)
            .eq("to_member_id", member.id)
            .eq("source_type", "allowance")
            .gte("created_at", weekStart.toISOString())
            .lte("created_at", weekEnd.toISOString());

          if ((existingAllowanceCount ?? 0) > 0) continue;

          // Find a parent/manager member to be the "from" side of the settlement
          const parentMember = members.find(
            (m) =>
              m.id !== member.id &&
              (m.role === "parent" || m.role === "manager")
          );

          if (!parentMember) continue;

          // Create an allowance settlement
          const payoutDescription =
            member.allowance_payout_type === "money"
              ? `Weekly allowance: $${(member.allowance_amount_cents / 100).toFixed(2)}`
              : member.allowance_reward_description ||
                `Weekly allowance: ${member.allowance_payout_type}`;

          const { error: settlementError } = await supabase
            .from("settlements")
            .insert({
              household_id: householdId,
              from_member_id: parentMember.id,
              to_member_id: member.id,
              payout_type: member.allowance_payout_type,
              amount_cents:
                member.allowance_payout_type === "money"
                  ? member.allowance_amount_cents
                  : null,
              payout_description: payoutDescription,
              description: `Allowance for week of ${weekStartStr} (${report.completionRate}% completion, grade: ${report.grade})`,
              source_type: "allowance",
              status: "pending",
              created_by: parentMember.id,
            });

          if (settlementError) {
            console.error(
              `Failed to create allowance settlement for member ${member.id}:`,
              settlementError
            );
          }
        }

        // --- g. Recalculate household health_score ---
        // Health score: weighted average of completion rate (50%), fairness (30%), streak health (20%)
        const avgStreak =
          members.length > 0
            ? members.reduce((sum, m) => sum + m.current_streak, 0) /
              members.length
            : 0;
        // Normalize streak to 0-100 scale (cap at 7 days = 100)
        const streakHealth = Math.min(100, (avgStreak / 7) * 100);

        const healthScore = Math.round(
          householdCompletionRate * 0.5 +
            householdFairness.score * 0.3 +
            streakHealth * 0.2
        );

        const { error: healthError } = await supabase
          .from("households")
          .update({
            health_score: Math.max(0, Math.min(100, healthScore)),
            health_score_updated_at: now.toISOString(),
          })
          .eq("id", householdId);

        if (healthError) {
          console.error(
            `Failed to update health score for household ${householdId}:`,
            healthError
          );
        }

        // --- h. Check recurring shopping items → auto-add ---
        const { data: shoppingLists } = await supabase
          .from("shopping_lists")
          .select("id, recurring_items")
          .eq("household_id", householdId)
          .eq("is_archived", false);

        if (shoppingLists?.length) {
          for (const list of shoppingLists) {
            const recurringItems: Array<{
              item_name: string;
              category?: string;
              frequency_days: number;
              last_added?: string;
            }> = list.recurring_items || [];

            if (!recurringItems.length) continue;

            let listUpdated = false;
            const updatedRecurring = [...recurringItems];

            for (let i = 0; i < updatedRecurring.length; i++) {
              const item = updatedRecurring[i];
              const lastAdded = item.last_added
                ? new Date(item.last_added)
                : null;

              // Check if enough days have passed since last addition
              const shouldAdd =
                !lastAdded ||
                (now.getTime() - lastAdded.getTime()) /
                  (1000 * 60 * 60 * 24) >=
                  item.frequency_days;

              if (!shouldAdd) continue;

              // Check if the item already exists unchecked in the list
              const { data: existingItems } = await supabase
                .from("shopping_items")
                .select("id")
                .eq("list_id", list.id)
                .eq("name", item.item_name)
                .eq("is_checked", false)
                .limit(1);

              if (existingItems && existingItems.length > 0) continue;

              // Auto-add the item
              const { error: itemError } = await supabase
                .from("shopping_items")
                .insert({
                  list_id: list.id,
                  household_id: householdId,
                  name: item.item_name,
                  category: item.category || null,
                  is_checked: false,
                  added_by: members[0].id, // Use first member as system actor
                });

              if (itemError) {
                console.error(
                  `Failed to auto-add shopping item "${item.item_name}":`,
                  itemError
                );
                continue;
              }

              // Update last_added date
              updatedRecurring[i] = {
                ...item,
                last_added: now.toISOString().split("T")[0],
              };
              listUpdated = true;
            }

            // Persist updated recurring_items back to the shopping list
            if (listUpdated) {
              await supabase
                .from("shopping_lists")
                .update({ recurring_items: updatedRecurring })
                .eq("id", list.id);
            }
          }
        }

        // --- i. Auto-close expired polls ---
        const { error: pollError } = await supabase
          .from("household_polls")
          .update({ is_closed: true })
          .eq("household_id", householdId)
          .eq("is_closed", false)
          .not("closes_at", "is", null)
          .lt("closes_at", now.toISOString());

        if (pollError) {
          console.error(
            `Failed to auto-close polls for household ${householdId}:`,
            pollError
          );
        }

        // Get the polls that were just closed to create activity entries
        const { data: closedPolls } = await supabase
          .from("household_polls")
          .select("id, question, created_by")
          .eq("household_id", householdId)
          .eq("is_closed", true)
          .not("closes_at", "is", null)
          .lt("closes_at", now.toISOString())
          .gte("closes_at", weekStart.toISOString());

        if (closedPolls?.length) {
          const pollActivityEntries = closedPolls.map((poll) => ({
            household_id: householdId,
            member_id: poll.created_by,
            action_type: "poll_closed" as const,
            metadata: {
              poll_id: poll.id,
              question: poll.question,
              auto_closed: true,
            },
            reactions: {},
          }));

          await supabase.from("activity_feed").insert(pollActivityEntries);
        }

        householdsProcessed++;
      } catch (householdError: any) {
        console.error(
          `Failed to process household ${householdId}:`,
          householdError
        );
        // Continue processing other households
      }
    }

    return NextResponse.json({
      success: true,
      householdsProcessed,
      totalHouseholds: householdIds.length,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error("Cron generate-reports error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
