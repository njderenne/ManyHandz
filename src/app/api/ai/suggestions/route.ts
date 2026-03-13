// ============================================================================
// ManyHandz — AI: Smart Suggestions
// Analyzes recent household data and provides actionable improvement suggestions.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyHouseholdMembership } from "@/lib/utils/auth-checks";
import { rateLimitAI, rateLimitResponse } from "@/lib/utils/rate-limit";
import OpenAI from "openai";

interface SuggestionRequest {
  householdId: string;
}

export interface AiSuggestion {
  id: string;
  icon: string;
  title: string;
  description: string;
  action_label: string;
  action_type:
    | "create_rotation"
    | "adjust_difficulty"
    | "reassign"
    | "create_bundle"
    | "set_reminder"
    | "swap_suggestion"
    | "create_challenge"
    | "general";
  action_data?: Record<string, unknown>;
  priority: "high" | "medium" | "low";
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimitAI(user.id);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const body = (await request.json()) as SuggestionRequest;
    const { householdId } = body;

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

    // Check monthly cost cap
    const { data: household } = await serviceClient
      .from("households")
      .select("ai_monthly_cost_cap_cents, name")
      .eq("id", householdId)
      .single();

    if (!household) {
      return NextResponse.json(
        { error: "Household not found" },
        { status: 404 }
      );
    }

    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const { data: monthlyVerifications } = await serviceClient
      .from("ai_verifications")
      .select("cost_cents, completions!inner(assignments!inner(household_id))")
      .eq("completions.assignments.household_id", householdId)
      .gte("created_at", startOfMonth.toISOString());

    const totalCostCents = (monthlyVerifications ?? []).reduce(
      (sum, v) => sum + (v.cost_cents ?? 0),
      0
    );

    if (totalCostCents >= (household.ai_monthly_cost_cap_cents ?? 500)) {
      return NextResponse.json(
        { error: "Monthly AI cost cap reached" },
        { status: 429 }
      );
    }

    // Fetch last 2 weeks of data
    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
    const twoWeeksAgoStr = twoWeeksAgo.toISOString();

    const [
      { data: members },
      { data: assignments },
      { data: completions },
      { data: chores },
    ] = await Promise.all([
      serviceClient
        .from("members")
        .select("id, display_name, current_streak, points_balance, role")
        .eq("household_id", householdId)
        .eq("is_active", true),
      serviceClient
        .from("assignments")
        .select("id, chore_id, assigned_to, due_date, status")
        .eq("household_id", householdId)
        .gte("due_date", twoWeeksAgoStr.split("T")[0]),
      serviceClient
        .from("completions")
        .select(
          "id, assignment_id, completed_by, points_earned, speed_bonus, status, actual_minutes"
        )
        .gte("completed_at", twoWeeksAgoStr)
        .in("status", ["approved", "ai_approved"]),
      serviceClient
        .from("chores")
        .select("id, name, difficulty, estimated_minutes, category_id")
        .eq("household_id", householdId)
        .eq("is_active", true),
    ]);

    // Build summary for AI
    const memberSummary = (members ?? []).map((m) => {
      const memberAssignments = (assignments ?? []).filter(
        (a) => a.assigned_to === m.id
      );
      const memberCompletions = (completions ?? []).filter(
        (c) => c.completed_by === m.id
      );
      const overdueCount = memberAssignments.filter(
        (a) => a.status === "overdue"
      ).length;
      const completedCount = memberCompletions.length;
      const totalPoints = memberCompletions.reduce(
        (sum, c) => sum + (c.points_earned ?? 0) + (c.speed_bonus ?? 0),
        0
      );

      return {
        name: m.display_name,
        role: m.role,
        streak: m.current_streak,
        assigned: memberAssignments.length,
        completed: completedCount,
        overdue: overdueCount,
        points: totalPoints,
      };
    });

    const choreSummary = (chores ?? []).map((c) => {
      const choreAssignments = (assignments ?? []).filter(
        (a) => a.chore_id === c.id
      );
      const overdueCount = choreAssignments.filter(
        (a) => a.status === "overdue"
      ).length;
      const completedCount = choreAssignments.filter(
        (a) => a.status === "completed"
      ).length;

      return {
        name: c.name,
        difficulty: c.difficulty,
        estimated_minutes: c.estimated_minutes,
        total_assigned: choreAssignments.length,
        completed: completedCount,
        overdue: overdueCount,
      };
    });

    const totalAssignments = (assignments ?? []).length;
    const totalOverdue = (assignments ?? []).filter(
      (a) => a.status === "overdue"
    ).length;
    const totalCompleted = (completions ?? []).length;

    const prompt = `You are a household management AI assistant for ManyHandz. Analyze this 2-week household data and provide 3-5 actionable suggestions to improve the household's chore management.

HOUSEHOLD: "${household.name}"
PERIOD: Last 2 weeks

MEMBERS:
${JSON.stringify(memberSummary, null, 2)}

CHORES:
${JSON.stringify(choreSummary, null, 2)}

OVERALL STATS:
- Total assignments: ${totalAssignments}
- Total completed: ${totalCompleted}
- Total overdue: ${totalOverdue}
- Completion rate: ${totalAssignments > 0 ? Math.round((totalCompleted / totalAssignments) * 100) : 0}%

Return ONLY valid JSON (no markdown, no code fences) as an array of suggestion objects:
[
  {
    "id": "<unique_id>",
    "icon": "<lucide icon name: e.g. RefreshCw, TrendingUp, Users, Star, AlertTriangle, Zap, Target, Gift>",
    "title": "<short title>",
    "description": "<2-3 sentence actionable suggestion>",
    "action_label": "<button text like 'Create Rotation' or 'Adjust Difficulty'>",
    "action_type": "<one of: create_rotation, adjust_difficulty, reassign, create_bundle, set_reminder, swap_suggestion, create_challenge, general>",
    "priority": "<high|medium|low>"
  }
]

Focus on:
1. Fairness imbalances between members
2. Consistently overdue chores
3. Streak improvements
4. Workload distribution
5. Difficulty adjustments for chores that are always late`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 1500,
      temperature: 0.7,
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.choices[0]?.message?.content ?? "[]";
    const suggestions = JSON.parse(text) as AiSuggestion[];

    return NextResponse.json({
      success: true,
      suggestions,
      meta: {
        period_days: 14,
        total_assignments: totalAssignments,
        total_completed: totalCompleted,
        total_overdue: totalOverdue,
        member_count: (members ?? []).length,
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
