"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { Reward, RewardRedemption, RewardRedemptionStatus } from "@/lib/supabase/types";

export type RewardRedemptionWithReward = RewardRedemption & {
  rewards: Record<string, unknown>;
  members: Record<string, unknown>;
};

export function useRewards() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Active rewards catalogue ----
  const { data: rewards = [], isLoading } = useQuery({
    queryKey: ["rewards", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("rewards")
        .select("id, household_id, name, description, icon, points_cost, is_active, created_by, created_at")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("points_cost", { ascending: true });
      if (error) throw error;
      return (data || []) as Reward[];
    },
    enabled: !!householdId,
  });

  // ---- Redemption history ----
  const { data: redemptions = [], isLoading: redemptionsLoading } = useQuery({
    queryKey: ["reward-redemptions", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("reward_redemptions")
        .select("*, rewards(*), members!member_id(*)")
        .eq("rewards.household_id", householdId)
        .order("redeemed_at", { ascending: false });
      if (error) throw error;
      return (data || []) as RewardRedemptionWithReward[];
    },
    enabled: !!householdId,
  });

  const pendingRedemptions = redemptions.filter((r) => r.status === "pending");

  const createReward = useMutation({
    mutationFn: async (reward: {
      name: string;
      description?: string;
      icon: string;
      points_cost: number;
      created_by: string;
    }) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("rewards")
        .insert({
          household_id: householdId,
          name: reward.name,
          description: reward.description || null,
          icon: reward.icon,
          points_cost: reward.points_cost,
          is_active: true,
          created_by: reward.created_by,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      toast.success("Reward created!");
    },
    onError: (e) => toast.error("Failed to create reward: " + e.message),
  });

  const updateReward = useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string | null;
      icon?: string;
      points_cost?: number;
    }) => {
      const { error } = await supabase
        .from("rewards")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      toast.success("Reward updated!");
    },
    onError: (e) => toast.error("Failed to update reward: " + e.message),
  });

  const deleteReward = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("rewards")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      toast.success("Reward removed.");
    },
    onError: (e) => toast.error("Failed to remove reward: " + e.message),
  });

  const redeemReward = useMutation({
    mutationFn: async (params: {
      rewardId: string;
      memberId: string;
      pointsCost: number;
    }) => {
      // Atomic via Postgres RPC — prevents double-spend race conditions
      const { error } = await supabase.rpc("redeem_reward", {
        p_member_id: params.memberId,
        p_reward_id: params.rewardId,
        p_points_cost: params.pointsCost,
      });
      if (error) {
        throw new Error(error.message.includes("Insufficient") ? "Not enough points to redeem this reward" : error.message);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["rewards"] });
      queryClient.invalidateQueries({ queryKey: ["reward-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["pending-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Reward redeemed!");
    },
    onError: (e) => toast.error(e.message),
  });

  const approveRedemption = useMutation({
    mutationFn: async ({
      redemptionId,
      approvedBy,
    }: {
      redemptionId: string;
      approvedBy: string;
    }) => {
      const { error } = await supabase
        .from("reward_redemptions")
        .update({
          status: "approved" as RewardRedemptionStatus,
          approved_by: approvedBy,
          approved_at: new Date().toISOString(),
        })
        .eq("id", redemptionId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reward-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["pending-redemptions"] });
      toast.success("Redemption approved!");
    },
    onError: (e) => toast.error("Failed to approve: " + e.message),
  });

  const rejectRedemption = useMutation({
    mutationFn: async ({
      redemptionId,
    }: {
      redemptionId: string;
      memberId: string;
      pointsRefund: number;
      approvedBy?: string;
    }) => {
      // Atomic refund via Postgres RPC — prevents race conditions
      const { error } = await supabase.rpc("refund_redemption", {
        p_redemption_id: redemptionId,
        p_approved_by: null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reward-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["pending-redemptions"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success("Redemption rejected, points refunded.");
    },
    onError: (e) => toast.error("Failed to reject: " + e.message),
  });

  return {
    rewards,
    redemptions,
    pendingRedemptions,
    isLoading,
    redemptionsLoading,
    createReward,
    updateReward,
    deleteReward,
    redeemReward,
    approveRedemption,
    rejectRedemption,
  };
}
