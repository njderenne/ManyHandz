import { createClient } from "../client";
import type { Member } from "../types";

export async function getMembersForHousehold(householdId: string): Promise<Member[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("members")
    .select("id, household_id, user_id, display_name, avatar_url, bio, birthday, favorite_color, role, points_balance, total_xp, current_level, current_streak, longest_streak, venmo_handle, paypal_handle, cashapp_handle, apple_cash_phone, is_active, away_until, away_reason, mute_celebrations, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_reward_description, allowance_threshold_pct, joined_at")
    .eq("household_id", householdId)
    .eq("is_active", true)
    .order("joined_at");
  return (data || []) as Member[];
}

export async function getMember(id: string): Promise<Member | null> {
  const supabase = createClient();
  const { data } = await supabase.from("members").select("id, household_id, user_id, display_name, avatar_url, bio, birthday, favorite_color, role, points_balance, total_xp, current_level, current_streak, longest_streak, venmo_handle, paypal_handle, cashapp_handle, apple_cash_phone, is_active, away_until, away_reason, mute_celebrations, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_reward_description, allowance_threshold_pct, joined_at").eq("id", id).single();
  return data as Member | null;
}

export async function joinHousehold(params: {
  householdId: string;
  userId: string;
  displayName: string;
  role: string;
  avatarUrl?: string;
}): Promise<Member> {
  const supabase = createClient();
  const { data, error } = await supabase.from("members").insert({
    household_id: params.householdId,
    user_id: params.userId,
    display_name: params.displayName,
    role: params.role,
    avatar_url: params.avatarUrl,
  }).select().single();
  if (error) throw error;
  return data as Member;
}

export async function updateMember(id: string, updates: Partial<Member>) {
  const supabase = createClient();
  const { error } = await supabase.from("members").update(updates).eq("id", id);
  if (error) throw error;
}
