"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { SwapRequest, SwapRequestStatus } from "@/lib/supabase/types";

export type SwapRequestWithRelations = SwapRequest & {
  requester: Record<string, unknown>;
  target: Record<string, unknown>;
  requester_assignment: Record<string, unknown> & { chores: Record<string, unknown> };
  target_assignment: (Record<string, unknown> & { chores: Record<string, unknown> }) | null;
};

export function useSwapRequests() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: swapRequests = [], isLoading } = useQuery({
    queryKey: ["swap-requests", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("swap_requests")
        .select(
          "*, requester:members!requester_id(*), target:members!target_id(*), requester_assignment:assignments!requester_assignment_id(*, chores(*)), target_assignment:assignments!target_assignment_id(*, chores(*))"
        )
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      return (data || []) as SwapRequestWithRelations[];
    },
    enabled: !!householdId,
  });

  const pendingSwaps = swapRequests.filter((s) => s.status === "pending");
  const resolvedSwaps = swapRequests.filter((s) => s.status !== "pending");

  const createSwap = useMutation({
    mutationFn: async (params: {
      requesterAssignmentId: string;
      targetAssignmentId?: string;
      requesterId: string;
      targetId: string;
      message?: string;
    }) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("swap_requests")
        .insert({
          household_id: householdId,
          requester_assignment_id: params.requesterAssignmentId,
          target_assignment_id: params.targetAssignmentId || null,
          requester_id: params.requesterId,
          target_id: params.targetId,
          message: params.message || null,
          status: "pending" as SwapRequestStatus,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      toast.success("Swap request sent!");
    },
    onError: (e) => toast.error("Failed to send swap request: " + e.message),
  });

  const respondToSwap = useMutation({
    mutationFn: async ({ id, accept }: { id: string; accept: boolean }) => {
      if (accept) {
        // Get the swap request details
        const { data: swap, error: fetchError } = await supabase
          .from("swap_requests")
          .select("id, requester_assignment_id, target_assignment_id, requester_id, target_id")
          .eq("id", id)
          .single();
        if (fetchError || !swap) throw new Error("Swap not found");

        // Swap assigned_to on both assignments
        if (swap.target_assignment_id) {
          const { data: reqAssign } = await supabase
            .from("assignments")
            .select("assigned_to")
            .eq("id", swap.requester_assignment_id)
            .single();
          const { data: tarAssign } = await supabase
            .from("assignments")
            .select("assigned_to")
            .eq("id", swap.target_assignment_id)
            .single();

          if (reqAssign && tarAssign) {
            await supabase
              .from("assignments")
              .update({ assigned_to: tarAssign.assigned_to })
              .eq("id", swap.requester_assignment_id);
            await supabase
              .from("assignments")
              .update({ assigned_to: reqAssign.assigned_to })
              .eq("id", swap.target_assignment_id);
          }
        } else {
          // Free swap — just reassign the requester's assignment to the target
          await supabase
            .from("assignments")
            .update({ assigned_to: swap.target_id })
            .eq("id", swap.requester_assignment_id);
        }

        const { error } = await supabase
          .from("swap_requests")
          .update({
            status: "accepted" as SwapRequestStatus,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("swap_requests")
          .update({
            status: "declined" as SwapRequestStatus,
            resolved_at: new Date().toISOString(),
          })
          .eq("id", id);
        if (error) throw error;
      }
    },
    onSuccess: (_, { accept }) => {
      queryClient.invalidateQueries({ queryKey: ["swap-requests"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      toast.success(accept ? "Swap accepted!" : "Swap declined.");
    },
    onError: (e) => toast.error("Failed to respond to swap: " + e.message),
  });

  return {
    swapRequests,
    pendingSwaps,
    resolvedSwaps,
    isLoading,
    createSwap,
    respondToSwap,
  };
}
