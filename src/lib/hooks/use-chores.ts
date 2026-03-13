"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";

export function useChores() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: chores = [], isLoading } = useQuery({
    queryKey: ["chores", householdId],
    staleTime: 2 * 60 * 1000, // 2 minutes — chore library changes infrequently
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("chores")
        .select("*, chore_categories(*)")
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
    enabled: !!householdId,
  });

  const createChore = useMutation({
    mutationFn: async (chore: {
      name: string;
      description?: string;
      difficulty: number;
      estimated_minutes: number;
      icon: string;
      category_id?: string;
      checklist?: Array<{ label: string; required: boolean }>;
      created_by: string;
      ai_verification_enabled?: boolean;
      requires_approval?: boolean;
    }) => {
      const { data, error } = await supabase.from("chores").insert({
        ...chore,
        household_id: householdId!,
        checklist: JSON.stringify(chore.checklist || []),
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chores"] });
      toast.success("Chore created!");
    },
    onError: (error) => {
      toast.error("Failed to create chore: " + error.message);
    },
  });

  const updateChore = useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; [key: string]: any }) => {
      const { error } = await supabase.from("chores").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chores"] });
      toast.success("Chore updated!");
    },
    onError: (error) => {
      toast.error("Failed to update chore: " + error.message);
    },
  });

  const deleteChore = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chores").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chores"] });
      toast.success("Chore deleted!");
    },
    onError: (error) => {
      toast.error("Failed to delete chore: " + error.message);
    },
  });

  return { chores, isLoading, createChore, updateChore, deleteChore };
}
