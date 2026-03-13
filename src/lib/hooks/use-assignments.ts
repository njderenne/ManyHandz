"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";

export function useAssignments(filters?: { status?: string; memberId?: string; dueDate?: string }) {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: assignments = [], isLoading } = useQuery({
    queryKey: ["assignments", householdId, filters],
    staleTime: 60 * 1000, // 1 min — assignments change frequently
    queryFn: async () => {
      if (!householdId) return [];
      // Bound to last 90 days to prevent unbounded growth
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const cutoffDate = cutoff.toISOString().split("T")[0];

      let query = supabase
        .from("assignments")
        .select("*, chores(*), members!assigned_to(*)")
        .eq("household_id", householdId)
        .gte("due_date", cutoffDate)
        .order("due_date", { ascending: true });

      if (filters?.status) query = query.eq("status", filters.status);
      if (filters?.memberId) query = query.eq("assigned_to", filters.memberId);
      if (filters?.dueDate) query = query.eq("due_date", filters.dueDate);

      const { data } = await query;
      return data || [];
    },
    enabled: !!householdId,
  });

  const completeAssignment = useMutation({
    mutationFn: async (params: {
      assignmentId: string;
      memberId: string;
      notes?: string;
      beforePhotoUrl?: string;
      afterPhotoUrl?: string;
      actualMinutes?: number;
      needsApproval: boolean;
      pointsEarned: number;
      speedBonus: number;
    }) => {
      const { data, error } = await supabase.from("completions").insert({
        assignment_id: params.assignmentId,
        completed_by: params.memberId,
        notes: params.notes,
        before_photo_url: params.beforePhotoUrl,
        after_photo_url: params.afterPhotoUrl,
        actual_minutes: params.actualMinutes,
        needs_approval: params.needsApproval,
        points_earned: params.pointsEarned,
        speed_bonus: params.speedBonus,
        status: params.needsApproval ? "pending_approval" : "approved",
      }).select().single();
      if (error) throw error;

      // Update assignment status -- use "pending_review" if needs approval, "completed" otherwise
      await supabase.from("assignments")
        .update({ status: params.needsApproval ? "pending_review" : "completed" })
        .eq("id", params.assignmentId);

      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Chore completed!");
    },
    onError: (error) => {
      toast.error("Failed to complete: " + error.message);
    },
  });

  return { assignments, isLoading, completeAssignment };
}
