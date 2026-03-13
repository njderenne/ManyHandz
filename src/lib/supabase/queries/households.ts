import { createClient } from "../client";
import type { Household } from "../types";

export async function getHousehold(id: string): Promise<Household | null> {
  const supabase = createClient();
  const { data } = await supabase.from("households").select("id, name, mode, invite_code, timezone, require_photo_proof, require_approval, leaderboard_visible, allow_kid_gifting, allow_kid_challenges, allow_kid_competitions, max_kid_competition_stakes, ai_verification_enabled, ai_verification_provider, ai_auto_approve_threshold, ai_auto_reject_threshold, ai_monthly_cost_cap_cents, health_score, health_score_updated_at, created_by, created_at, updated_at").eq("id", id).single();
  return data as Household | null;
}

export async function createHousehold(params: {
  name: string;
  mode: string;
  createdBy: string;
  timezone?: string;
}): Promise<Household | null> {
  const supabase = createClient();
  const { data, error } = await supabase.from("households").insert({
    name: params.name,
    mode: params.mode,
    created_by: params.createdBy,
    timezone: params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  }).select().single();
  if (error) throw error;
  return data as Household;
}

export async function updateHousehold(id: string, updates: Partial<Household>) {
  const supabase = createClient();
  const { error } = await supabase.from("households").update(updates).eq("id", id);
  if (error) throw error;
}

export async function getHouseholdByInviteCode(code: string): Promise<Household | null> {
  // Uses API route with service-role client to bypass RLS —
  // new users who aren't members yet can't read the households table directly
  const res = await fetch(`/api/households/lookup?code=${encodeURIComponent(code)}`);
  if (!res.ok) return null;
  const { household } = await res.json();
  return household as Household | null;
}
