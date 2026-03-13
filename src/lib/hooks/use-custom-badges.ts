"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type {
  CustomBadge,
  CustomBadgeAward,
  CustomBadgeCriteriaType,
} from "@/lib/supabase/types";

export type CustomBadgeWithAwards = CustomBadge & {
  custom_badge_awards: (CustomBadgeAward & {
    members: Record<string, unknown>;
  })[];
};

export function useCustomBadges() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Fetch all custom badges with their awards ----
  const { data: badges = [], isLoading } = useQuery({
    queryKey: ["custom-badges", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("custom_badges")
        .select(
          "*, custom_badge_awards(*, members!member_id(*))"
        )
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as CustomBadgeWithAwards[];
    },
    enabled: !!householdId,
  });

  // ---- Fetch awards for a specific member ----
  const useMemberBadges = (memberId: string | null) =>
    useQuery({
      queryKey: ["member-badges", memberId],
      queryFn: async () => {
        if (!memberId) return [];
        const { data, error } = await supabase
          .from("custom_badge_awards")
          .select("*, custom_badges!badge_id(*)")
          .eq("member_id", memberId)
          .order("awarded_at", { ascending: false });
        if (error) throw error;
        return data || [];
      },
      enabled: !!memberId,
    });

  const createBadge = useMutation({
    mutationFn: async (badge: {
      name: string;
      description: string;
      icon: string;
      color: string;
      criteria_type: CustomBadgeCriteriaType;
      criteria_target?: number;
      criteria_category_id?: string;
      created_by: string;
    }) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("custom_badges")
        .insert({
          household_id: householdId,
          name: badge.name,
          description: badge.description,
          icon: badge.icon,
          color: badge.color,
          criteria_type: badge.criteria_type,
          criteria_target: badge.criteria_target || null,
          criteria_category_id: badge.criteria_category_id || null,
          is_active: true,
          created_by: badge.created_by,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-badges"] });
      toast.success("Badge created!");
    },
    onError: (e) => toast.error("Failed to create badge: " + e.message),
  });

  const updateBadge = useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string;
      icon?: string;
      color?: string;
      criteria_type?: CustomBadgeCriteriaType;
      criteria_target?: number | null;
      criteria_category_id?: string | null;
    }) => {
      const { error } = await supabase
        .from("custom_badges")
        .update(updates)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-badges"] });
      toast.success("Badge updated!");
    },
    onError: (e) => toast.error("Failed to update badge: " + e.message),
  });

  const deleteBadge = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("custom_badges")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-badges"] });
      toast.success("Badge removed.");
    },
    onError: (e) => toast.error("Failed to remove badge: " + e.message),
  });

  const awardBadge = useMutation({
    mutationFn: async (params: {
      badgeId: string;
      memberId: string;
      awardedBy: string;
    }) => {
      // Check for duplicate awards
      const { data: existing } = await supabase
        .from("custom_badge_awards")
        .select("id")
        .eq("badge_id", params.badgeId)
        .eq("member_id", params.memberId)
        .maybeSingle();

      if (existing) {
        throw new Error("This member already has this badge");
      }

      const { data, error } = await supabase
        .from("custom_badge_awards")
        .insert({
          badge_id: params.badgeId,
          member_id: params.memberId,
          awarded_by: params.awardedBy,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-badges"] });
      queryClient.invalidateQueries({ queryKey: ["member-badges"] });
      toast.success("Badge awarded!");
    },
    onError: (e) => toast.error(e.message),
  });

  const revokeBadge = useMutation({
    mutationFn: async (awardId: string) => {
      const { error } = await supabase
        .from("custom_badge_awards")
        .delete()
        .eq("id", awardId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["custom-badges"] });
      queryClient.invalidateQueries({ queryKey: ["member-badges"] });
      toast.success("Badge revoked.");
    },
    onError: (e) => toast.error("Failed to revoke badge: " + e.message),
  });

  return {
    badges,
    isLoading,
    useMemberBadges,
    createBadge,
    updateBadge,
    deleteBadge,
    awardBadge,
    revokeBadge,
  };
}
