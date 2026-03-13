"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { Member } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check whether a member is currently in vacation / away mode */
export function isMemberAway(member: Member): boolean {
  return !!member.away_until && new Date(member.away_until) > new Date();
}

/** Days remaining until the member returns (0 if not away) */
export function daysUntilReturn(member: Member): number {
  if (!member.away_until) return 0;
  const diff = new Date(member.away_until).getTime() - Date.now();
  return diff > 0 ? Math.ceil(diff / (1000 * 60 * 60 * 24)) : 0;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useVacationMode() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  /** Enable vacation / away mode for a member */
  const enableVacation = useMutation({
    mutationFn: async (params: {
      memberId: string;
      awayUntil: string; // ISO date string
      awayReason?: string;
      reassignChores?: boolean;
      reassignToId?: string;
    }) => {
      if (!householdId) throw new Error("No household selected");

      // Set the member as away
      const { error: memberError } = await supabase
        .from("members")
        .update({
          away_until: new Date(params.awayUntil).toISOString(),
          away_reason: params.awayReason || null,
        })
        .eq("id", params.memberId);
      if (memberError) throw memberError;

      // Optionally reassign pending/in-progress assignments during the away period
      if (params.reassignChores && params.reassignToId) {
        const { data: pendingAssignments, error: fetchError } = await supabase
          .from("assignments")
          .select("id, due_date")
          .eq("household_id", householdId)
          .eq("assigned_to", params.memberId)
          .in("status", ["pending", "in_progress"])
          .lte("due_date", params.awayUntil);
        if (fetchError) throw fetchError;

        if (pendingAssignments && pendingAssignments.length > 0) {
          const ids = pendingAssignments.map((a) => a.id);
          const { error: reassignError } = await supabase
            .from("assignments")
            .update({ assigned_to: params.reassignToId })
            .in("id", ids);
          if (reassignError) throw reassignError;
        }
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      const msg = vars.reassignChores
        ? "Vacation mode enabled and chores reassigned!"
        : "Vacation mode enabled!";
      toast.success(msg);
    },
    onError: (e) => toast.error("Failed to enable vacation mode: " + e.message),
  });

  /** Disable vacation / away mode (return early) */
  const disableVacation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from("members")
        .update({ away_until: null, away_reason: null })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Welcome back! Vacation mode disabled.");
    },
    onError: (e) => toast.error("Failed to disable vacation mode: " + e.message),
  });

  /** Extend the away date for a member who is already away */
  const extendVacation = useMutation({
    mutationFn: async (params: { memberId: string; newAwayUntil: string }) => {
      const { error } = await supabase
        .from("members")
        .update({ away_until: new Date(params.newAwayUntil).toISOString() })
        .eq("id", params.memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Vacation extended!");
    },
    onError: (e) => toast.error("Failed to extend vacation: " + e.message),
  });

  return {
    enableVacation,
    disableVacation,
    extendVacation,
    isMemberAway,
    daysUntilReturn,
  };
}
