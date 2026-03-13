"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { Competition, CompetitionType } from "@/lib/supabase/types";

export interface CreateCompetitionInput {
  challenger_id: string;
  opponent_id: string;
  title: string;
  competition_type: CompetitionType;
  target_value?: number;
  chore_id?: string;
  stakes_points: number;
  stakes_description?: string;
  starts_at: string;
  ends_at: string;
}

export type CompetitionWithMembers = Competition & {
  challenger: Record<string, unknown>;
  opponent: Record<string, unknown>;
  chores?: Record<string, unknown> | null;
};

export function useCompetitions() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: competitions = [], isLoading } = useQuery({
    queryKey: ["competitions", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("competitions")
        .select(
          "*, challenger:members!challenger_id(*), opponent:members!opponent_id(*), chores(*)"
        )
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      return (data || []) as CompetitionWithMembers[];
    },
    enabled: !!householdId,
  });

  const activeCompetitions = competitions.filter((c) => c.status === "active");
  const pendingCompetitions = competitions.filter((c) => c.status === "pending");
  const pastCompetitions = competitions.filter(
    (c) => c.status === "completed" || c.status === "declined" || c.status === "expired"
  );

  const createCompetition = useMutation({
    mutationFn: async (input: CreateCompetitionInput) => {
      const { data, error } = await supabase
        .from("competitions")
        .insert({
          ...input,
          household_id: householdId!,
          status: "pending" as const,
          challenger_progress: 0,
          opponent_progress: 0,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
      toast.success("Competition challenge sent!");
    },
    onError: (e) => toast.error(e.message),
  });

  const acceptCompetition = useMutation({
    mutationFn: async (competitionId: string) => {
      const { data, error } = await supabase
        .from("competitions")
        .update({ status: "active" as const })
        .eq("id", competitionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
      toast.success("Competition accepted! Game on!");
    },
    onError: (e) => toast.error(e.message),
  });

  const declineCompetition = useMutation({
    mutationFn: async (competitionId: string) => {
      const { data, error } = await supabase
        .from("competitions")
        .update({ status: "declined" as const })
        .eq("id", competitionId)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["competitions"] });
      toast.success("Competition declined.");
    },
    onError: (e) => toast.error(e.message),
  });

  return {
    competitions,
    activeCompetitions,
    pendingCompetitions,
    pastCompetitions,
    isLoading,
    createCompetition,
    acceptCompetition,
    declineCompetition,
  };
}
