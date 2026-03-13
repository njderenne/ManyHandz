// ============================================================================
// ManyHandz — Cron: Check Overdue Assignments
// Hourly: finds all pending/in_progress assignments past their due date,
// marks them overdue, and sends push notifications to affected members.
//
// NOTE: Streak resets and activity feed entries are handled by the
// handle_assignment_overdue() database trigger (fires per-row on status
// change to 'overdue'). This cron only handles the batch status update
// and push notifications (which cannot be sent from a Postgres trigger).
// ============================================================================

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToUser } from "@/lib/utils/push";

/** Extract chore name from Supabase join result (may be object or array) */
function getChoreName(row: Record<string, unknown>, fallback = "Unknown chore"): string {
  const chores = row.chores;
  if (!chores) return fallback;
  if (Array.isArray(chores)) return (chores[0] as { name?: string })?.name || fallback;
  return (chores as { name?: string }).name || fallback;
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
    const today = now.toISOString().split("T")[0]; // YYYY-MM-DD

    // 1. Find all assignments that are past due and still pending or in_progress
    const { data: overdueAssignments, error: fetchError } = await supabase
      .from("assignments")
      .select("id, assigned_to, household_id, chore_id, due_date, chores(name)")
      .in("status", ["pending", "in_progress"])
      .lt("due_date", today);

    if (fetchError) throw fetchError;

    if (!overdueAssignments?.length) {
      return NextResponse.json({
        success: true,
        overdueCount: 0,
        message: "No overdue assignments found",
      });
    }

    // 2. Batch update all overdue assignments
    const overdueIds = overdueAssignments.map((a) => a.id);

    const { error: updateError } = await supabase
      .from("assignments")
      .update({
        status: "overdue",
        updated_at: now.toISOString(),
      })
      .in("id", overdueIds);

    if (updateError) throw updateError;

    // NOTE: Steps 3 & 4 (streak reset + activity feed) are now handled by
    // the handle_assignment_overdue() database trigger, which fires per-row
    // when status transitions to 'overdue'. Doing them here as well caused
    // duplicate activity entries and redundant streak resets.

    // 3. Send push notifications to overdue members
    // (Push cannot be sent from a Postgres trigger, so it stays here)
    const uniqueMemberIds = [
      ...new Set(overdueAssignments.map((a) => a.assigned_to)),
    ];

    const { data: members } = await supabase
      .from("members")
      .select("id, user_id, display_name")
      .in("id", uniqueMemberIds);

    const memberMap = new Map(
      (members || []).map((m) => [m.id, m])
    );

    for (const assignment of overdueAssignments) {
      const member = memberMap.get(assignment.assigned_to);
      if (!member?.user_id) continue;

      const choreName = getChoreName(assignment as Record<string, unknown>, "a chore");

      try {
        await sendPushToUser(member.user_id, {
          title: "Overdue Assignment",
          body: `Your assignment "${choreName}" is now overdue. Please complete it as soon as possible!`,
          icon: "/icons/warning.png",
          tag: `overdue-${assignment.id}`,
          data: {
            url: `/assignments/${assignment.id}`,
            type: "overdue",
          },
          actions: [
            { action: "view", title: "View Assignment" },
            { action: "complete", title: "Mark Complete" },
          ],
        });
      } catch (pushError) {
        console.error(
          `Failed to send push notification to user ${member.user_id}:`,
          pushError
        );
      }
    }

    return NextResponse.json({
      success: true,
      overdueCount: overdueAssignments.length,
      membersAffected: uniqueMemberIds.length,
      timestamp: now.toISOString(),
    });
  } catch (error: any) {
    console.error("Cron check-overdue error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
