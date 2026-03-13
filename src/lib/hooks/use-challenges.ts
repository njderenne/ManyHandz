"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { BonusChallenge, ChallengeType } from "@/lib/supabase/types";

export interface CreateChallengeInput {
  title: string;
  description?: string;
  challenge_type: ChallengeType;
  target_value?: number;
  bonus_points: number;
  points_multiplier: number;
  starts_at: string;
  ends_at: string;
  created_by: string;
}

export function useChallenges() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ["challenges", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("bonus_challenges")
        .select("*, members!created_by(*)")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      return (data || []) as (BonusChallenge & { members: Record<string, unknown> })[];
    },
    enabled: !!householdId,
  });

  const activeChallenges = challenges.filter(
    (c) => c.status === "active" && new Date(c.ends_at) > new Date()
  );

  const pastChallenges = challenges.filter(
    (c) => c.status !== "active" || new Date(c.ends_at) <= new Date()
  );

  const createChallenge = useMutation({
    mutationFn: async (challenge: CreateChallengeInput) => {
      const { data, error } = await supabase
        .from("bonus_challenges")
        .insert({
          ...challenge,
          household_id: householdId!,
          status: "active" as const,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["challenges"] });
      toast.success("Challenge created!");
    },
    onError: (e) => toast.error(e.message),
  });

  return { challenges, activeChallenges, pastChallenges, isLoading, createChallenge };
}
