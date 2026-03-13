// ============================================================================
// ManyHandz — Cron: Check Competitions
// Hourly: resolves active competitions that have passed their ends_at time.
//
// Competition types:
// - most_points: winner has higher progress (points accumulated)
// - most_completions: winner has more completions
// - first_to_target: first to reach target_value wins (may already be resolved)
// - specific_chore_race: most completions of a specific chore
//
// On resolution: sets winner_id, transfers stakes points from loser to winner,
// and creates activity feed entries.
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

    // 1. Get all active competitions that have ended
    const { data: competitions, error: fetchError } = await supabase
      .from("competitions")
      .select("id, household_id, challenger_id, opponent_id, title, competition_type, target_value, chore_id, stakes_points, stakes_description, challenger_progress, opponent_progress, status, winner_id, starts_at, ends_at")
      .eq("status", "active")
      .lt("ends_at", nowISO);

    if (fetchError) throw fetchError;

    if (!competitions?.length) {
      return NextResponse.json({
        success: true,
        resolved: 0,
        message: "No expired competitions to resolve",
      });
    }

    let resolvedCount = 0;

    for (const comp of competitions) {
      let winnerId: string | null = null;
      let loserId: string | null = null;

      // Determine winner based on competition type
      switch (comp.competition_type) {
        case "most_points":
        case "most_completions":
        case "specific_chore_race": {
          // Compare challenger_progress vs opponent_progress
          if (comp.challenger_progress > comp.opponent_progress) {
            winnerId = comp.challenger_id;
            loserId = comp.opponent_id;
          } else if (comp.opponent_progress > comp.challenger_progress) {
            winnerId = comp.opponent_id;
            loserId = comp.challenger_id;
          }
          // If equal, it's a tie — no winner, no stakes transfer
          break;
        }

        case "first_to_target": {
          const target = comp.target_value || 0;
          // Check if either reached the target
          if (comp.challenger_progress >= target && comp.opponent_progress < target) {
            winnerId = comp.challenger_id;
            loserId = comp.opponent_id;
          } else if (comp.opponent_progress >= target && comp.challenger_progress < target) {
            winnerId = comp.opponent_id;
            loserId = comp.challenger_id;
          } else if (comp.challenger_progress >= target && comp.opponent_progress >= target) {
            // Both reached target — compare who has more progress
            if (comp.challenger_progress > comp.opponent_progress) {
              winnerId = comp.challenger_id;
              loserId = comp.opponent_id;
            } else if (comp.opponent_progress > comp.challenger_progress) {
              winnerId = comp.opponent_id;
              loserId = comp.challenger_id;
            }
            // If exactly equal, it's a tie
          }
          // Neither reached target — no winner
          break;
        }
      }

      // 2. Update the competition status
      const { error: updateError } = await supabase
        .from("competitions")
        .update({
          status: "completed",
          winner_id: winnerId,
        })
        .eq("id", comp.id);

      if (updateError) {
        console.error(
          `Failed to update competition ${comp.id}:`,
          updateError
        );
        continue;
      }

      // 3. Transfer stakes points if there is a winner and loser
      // NOTE: We use two separate award_bonus_points RPCs instead of a single
      // transfer_points RPC because: (a) transfer_points would fail if the
      // loser has insufficient points — competitions shouldn't prevent winners
      // from receiving their reward; (b) award_bonus_points floors at 0 for
      // deductions, which is the desired behavior for losers. Winner is
      // credited first so partial failures favor the winner.
      if (winnerId && loserId && comp.stakes_points > 0) {
        // Award bonus points to winner atomically
        const { error: winnerError } = await supabase.rpc("award_bonus_points", {
          p_member_id: winnerId,
          p_bonus_points: comp.stakes_points,
        });

        if (winnerError) {
          console.error(
            `Failed to add stakes to winner ${winnerId}:`,
            winnerError
          );
        }

        // Deduct stakes from loser atomically (floors at 0 in the RPC)
        const { error: loserError } = await supabase.rpc("award_bonus_points", {
          p_member_id: loserId,
          p_bonus_points: -comp.stakes_points,
        });

        if (loserError) {
          console.error(
            `Failed to deduct stakes from loser ${loserId}:`,
            loserError
          );
        }
      }

      // 4. Create activity feed entry
      const { data: winnerMember } = winnerId
        ? await supabase
            .from("members")
            .select("display_name")
            .eq("id", winnerId)
            .single()
        : { data: null };

      const { error: activityError } = await supabase
        .from("activity_feed")
        .insert({
          household_id: comp.household_id,
          member_id: winnerId,
          action_type: "competition_completed",
          metadata: {
            competition_id: comp.id,
            competition_title: comp.title,
            competition_type: comp.competition_type,
            winner_id: winnerId,
            winner_name: winnerMember?.display_name || null,
            challenger_id: comp.challenger_id,
            opponent_id: comp.opponent_id,
            challenger_progress: comp.challenger_progress,
            opponent_progress: comp.opponent_progress,
            stakes_points: comp.stakes_points,
            stakes_description: comp.stakes_description,
            is_tie: !winnerId,
          },
          reactions: {},
        });

      if (activityError) {
        console.error(
          `Failed to create activity for competition ${comp.id}:`,
          activityError
        );
      }

      resolvedCount++;
    }

    return NextResponse.json({
      success: true,
      resolved: resolvedCount,
      total: competitions.length,
      timestamp: nowISO,
    });
  } catch (error: any) {
    console.error("Cron check-competitions error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
