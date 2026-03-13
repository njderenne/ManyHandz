"use client";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { useAuth } from "./use-auth";
import type { Member } from "@/lib/supabase/types";

export function useMembers() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { user } = useAuth();

  const { data: members = [], isLoading } = useQuery({
    queryKey: ["members", householdId],
    staleTime: 2 * 60 * 1000, // 2 min — members change on profile edits, point mutations
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("members")
        .select("id, household_id, user_id, display_name, avatar_url, bio, birthday, favorite_color, role, points_balance, total_xp, current_level, current_streak, longest_streak, venmo_handle, paypal_handle, cashapp_handle, apple_cash_phone, is_active, away_until, away_reason, mute_celebrations, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_reward_description, allowance_threshold_pct, joined_at")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("joined_at");
      return (data || []) as Member[];
    },
    enabled: !!householdId,
  });

  // Derive currentMember from the members list — eliminates the redundant
  // ["current-member"] query that duplicated the DB call
  const currentMember = useMemo(() => {
    if (!user?.id || members.length === 0) return null;
    return members.find((m) => m.user_id === user.id) ?? null;
  }, [members, user?.id]);

  return { members, currentMember, isLoading };
}
