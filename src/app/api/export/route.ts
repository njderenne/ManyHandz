import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { verifyHouseholdMembership } from "@/lib/utils/auth-checks";
import { rateLimitExport, rateLimitResponse } from "@/lib/utils/rate-limit";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimitExport(user.id);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const { searchParams } = new URL(request.url);
    const type = searchParams.get("type") || "completions";
    const format = searchParams.get("format") || "csv";
    const householdId = searchParams.get("household_id");
    const startDate = searchParams.get("start");
    const endDate = searchParams.get("end");

    if (!householdId) return NextResponse.json({ error: "household_id required" }, { status: 400 });

    // Verify user is an active member of this household
    const member = await verifyHouseholdMembership(supabase, user.id, householdId);
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Full data exports (with member details) require admin role
    if (type === "full" && !["parent", "manager"].includes(member.role)) {
      return NextResponse.json(
        { error: "Full export requires admin role" },
        { status: 403 }
      );
    }

    let data: Record<string, unknown>[] = [];

    if (type === "completions") {
      let query = supabase
        .from("completions")
        .select("*, assignments(*, chores(*), members!assigned_to(display_name))")
        .eq("assignments.household_id", householdId);
      if (startDate) query = query.gte("completed_at", startDate);
      if (endDate) query = query.lte("completed_at", endDate);
      const result = await query;
      data = result.data || [];
    } else if (type === "fairness") {
      const { data: members } = await supabase
        .from("members")
        .select("id, display_name, role, points_balance, total_xp, current_level, current_streak, longest_streak")
        .eq("household_id", householdId);
      data = members || [];
    } else if (type === "full") {
      // Full JSON backup — explicit columns for each table
      const [chores, assignments, completions, members] = await Promise.all([
        supabase.from("chores").select("id, household_id, category_id, name, description, difficulty, estimated_minutes, icon, reference_photo_url, ai_verification_enabled, requires_approval, checklist, is_active, created_by, created_at, updated_at").eq("household_id", householdId),
        supabase.from("assignments").select("id, chore_id, household_id, assigned_to, rotation_group_id, due_date, due_time, original_due_date, snooze_count, checklist_progress, status, skip_reason, created_at, updated_at").eq("household_id", householdId),
        supabase.from("completions").select("id, assignment_id, completed_by, completed_at, before_photo_url, after_photo_url, notes, points_earned, speed_bonus, actual_minutes, approved_by, approved_at, rejection_reason, needs_approval, status, assignments!inner(household_id)").eq("assignments.household_id", householdId),
        supabase.from("members").select("id, household_id, user_id, display_name, avatar_url, bio, birthday, favorite_color, role, points_balance, total_xp, current_level, current_streak, longest_streak, is_active, away_until, away_reason, mute_celebrations, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_threshold_pct, joined_at").eq("household_id", householdId),
      ]);
      data = [{ chores: chores.data, assignments: assignments.data, completions: completions.data, members: members.data }];
    }

    if (format === "csv") {
      if (data.length === 0) return new NextResponse("No data", { status: 200 });
      const headers = Object.keys(data[0] || {});
      const csv = [headers.join(","), ...data.map(row => headers.map(h => JSON.stringify(row[h] ?? "")).join(","))].join("\n");
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename=${type}_export.csv` },
      });
    }

    return NextResponse.json(data, {
      headers: format === "json" ? { "Content-Disposition": `attachment; filename=${type}_export.json` } : {},
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
