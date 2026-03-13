// ============================================================================
// ManyHandz — Cron: Check Challenges
// Hourly: evaluates active bonus challenges for expiry and completion.
//
// Challenge types:
// - double_points / custom: expire when ends_at passes (no auto-completion logic)
// - complete_count: check if household completions >= target_value in period
// - no_overdue: check if any overdue assignments exist in the challenge period
// ============================================================================

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";

export async function POST(request: Request) {
  // Double-check cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    const now = new Date();
    const nowISO = now.toISOString();

    // 1. Get all active challenges
    const { data: challenges, error: fetchError } = await supabase
      .from("bonus_challenges")
      .select("id, household_id, title, challenge_type, target_value, bonus_points, points_multiplier, starts_at, ends_at, status, created_by")
      .eq("status", "active");

    if (fetchError) throw fetchError;

    if (!challenges?.length) {
      return NextResponse.json({
        success: true,
        processed: 0,
        message: "No active challenges",
      });
    }

    let completedCount = 0;
    let failedCount = 0;
    let expiredCount = 0;

    for (const challenge of challenges) {
      const endsAt = new Date(challenge.ends_at);
      const isExpired = endsAt < now;

      if (!isExpired) continue; // Challenge is still within its active period

      let newStatus: "completed" | "failed" | "expired" = "expired";

      // --- complete_count: did the household reach the target number of completions? ---
      if (challenge.challenge_type === "complete_count") {
        // Scope completions to this challenge's household via assignments join
        const { count, error: countError } = await supabase
          .from("completions")
          .select("id, assignments!inner(household_id)", { count: "exact", head: true })
          .eq("assignments.household_id", challenge.household_id)
          .gte("completed_at", challenge.starts_at)
          .lte("completed_at", challenge.ends_at)
          .in("status", ["approved", "ai_approved"]);

        if (countError) {
          console.error(
            `Failed to count completions for challenge ${challenge.id}:`,
            countError
          );
          continue;
        }

        const totalCompletions = count || 0;
        const target = challenge.target_value || 0;

        if (totalCompletions >= target) {
          newStatus = "completed";
        } else {
          newStatus = "failed";
        }
      }

      // --- no_overdue: did any assignment go overdue during the challenge period? ---
      else if (challenge.challenge_type === "no_overdue") {
        // Check if any assignments in this household became overdue during the period
        const { count: overdueCount, error: overdueError } = await supabase
          .from("assignments")
          .select("id", { count: "exact", head: true })
          .eq("household_id", challenge.household_id)
          .eq("status", "overdue")
          .gte("due_date", challenge.starts_at.split("T")[0])
          .lte("due_date", challenge.ends_at.split("T")[0]);

        if (overdueError) {
          console.error(
            `Failed to check overdue for challenge ${challenge.id}:`,
            overdueError
          );
          continue;
        }

        if ((overdueCount || 0) === 0) {
          newStatus = "completed";
        } else {
          newStatus = "failed";
        }
      }

      // --- double_points / custom: simply expire (they provide ongoing multipliers) ---
      else {
        newStatus = "expired";
      }

      // 2. Update the challenge status
      const { error: updateError } = await supabase
        .from("bonus_challenges")
        .update({ status: newStatus })
        .eq("id", challenge.id);

      if (updateError) {
        console.error(
          `Failed to update challenge ${challenge.id}:`,
          updateError
        );
        continue;
      }

      // 3. Award bonus points if the challenge was completed
      if (newStatus === "completed" && challenge.bonus_points > 0) {
        // Get all active members of the household to award bonus points
        const { data: householdMembers, error: membersError } = await supabase
          .from("members")
          .select("id")
          .eq("household_id", challenge.household_id)
          .eq("is_active", true);

        if (membersError) {
          console.error(
            `Failed to fetch members for challenge ${challenge.id}:`,
            membersError
          );
        } else if (householdMembers?.length) {
          // Award bonus points atomically via RPC to prevent race conditions
          for (const member of householdMembers) {
            const { error: pointsError } = await supabase.rpc("award_bonus_points", {
              p_member_id: member.id,
              p_bonus_points: challenge.bonus_points,
            });

            if (pointsError) {
              console.error(
                `Failed to award points to member ${member.id}:`,
                pointsError
              );
            }
          }

          // Create activity feed entry for the completed challenge
          const { error: activityError } = await supabase
            .from("activity_feed")
            .insert({
              household_id: challenge.household_id,
              member_id: challenge.created_by,
              action_type: "challenge_completed",
              metadata: {
                challenge_id: challenge.id,
                challenge_title: challenge.title,
                challenge_type: challenge.challenge_type,
                bonus_points: challenge.bonus_points,
                members_awarded: householdMembers.length,
              },
              reactions: {},
            });

          if (activityError) {
            console.error(
              `Failed to create activity for challenge ${challenge.id}:`,
              activityError
            );
          }
        }

        completedCount++;
      } else if (newStatus === "failed") {
        failedCount++;
      } else {
        expiredCount++;
      }
    }

    return NextResponse.json({
      success: true,
      processed: completedCount + failedCount + expiredCount,
      completed: completedCount,
      failed: failedCount,
      expired: expiredCount,
      timestamp: nowISO,
    });
  } catch (error: any) {
    console.error("Cron check-challenges error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
