"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { ChoreBundle, ChoreBundleItem } from "@/lib/supabase/types";

export type BundleWithItems = ChoreBundle & {
  chore_bundle_items: (ChoreBundleItem & {
    chores: Record<string, unknown>;
  })[];
};

export function useBundles() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Fetch all bundles with their chore items ----
  const { data: bundles = [], isLoading } = useQuery({
    queryKey: ["bundles", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("chore_bundles")
        .select(
          "*, chore_bundle_items(*, chores(*))"
        )
        .eq("household_id", householdId)
        .eq("is_active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as BundleWithItems[];
    },
    enabled: !!householdId,
  });

  const createBundle = useMutation({
    mutationFn: async (bundle: {
      name: string;
      description?: string;
      icon: string;
      choreIds: string[];
      created_by: string;
    }) => {
      if (!householdId) throw new Error("No household selected");

      // Create the bundle first
      const { data: newBundle, error: bundleError } = await supabase
        .from("chore_bundles")
        .insert({
          household_id: householdId,
          name: bundle.name,
          description: bundle.description || null,
          icon: bundle.icon,
          is_active: true,
          created_by: bundle.created_by,
        })
        .select()
        .single();
      if (bundleError) throw bundleError;

      // Add chore items to the bundle
      if (bundle.choreIds.length > 0) {
        const items = bundle.choreIds.map((choreId, index) => ({
          bundle_id: newBundle.id,
          chore_id: choreId,
          sort_order: index,
        }));
        const { error: itemsError } = await supabase
          .from("chore_bundle_items")
          .insert(items);
        if (itemsError) throw itemsError;
      }

      return newBundle;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      toast.success("Bundle created!");
    },
    onError: (e) => toast.error("Failed to create bundle: " + e.message),
  });

  const updateBundle = useMutation({
    mutationFn: async ({
      id,
      choreIds,
      ...updates
    }: {
      id: string;
      name?: string;
      description?: string | null;
      icon?: string;
      choreIds?: string[];
    }) => {
      // Update bundle metadata
      if (Object.keys(updates).length > 0) {
        const { error } = await supabase
          .from("chore_bundles")
          .update(updates)
          .eq("id", id);
        if (error) throw error;
      }

      // Update chore items if provided
      if (choreIds !== undefined) {
        // Remove existing items
        const { error: deleteError } = await supabase
          .from("chore_bundle_items")
          .delete()
          .eq("bundle_id", id);
        if (deleteError) throw deleteError;

        // Insert new items
        if (choreIds.length > 0) {
          const items = choreIds.map((choreId, index) => ({
            bundle_id: id,
            chore_id: choreId,
            sort_order: index,
          }));
          const { error: insertError } = await supabase
            .from("chore_bundle_items")
            .insert(items);
          if (insertError) throw insertError;
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      toast.success("Bundle updated!");
    },
    onError: (e) => toast.error("Failed to update bundle: " + e.message),
  });

  const deleteBundle = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("chore_bundles")
        .update({ is_active: false })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      toast.success("Bundle removed.");
    },
    onError: (e) => toast.error("Failed to remove bundle: " + e.message),
  });

  const assignBundle = useMutation({
    mutationFn: async (params: {
      bundleId: string;
      memberId: string;
      dueDate: string;
      dueTime?: string;
    }) => {
      // Get the bundle's chores
      const { data: items, error: fetchError } = await supabase
        .from("chore_bundle_items")
        .select("chore_id, sort_order")
        .eq("bundle_id", params.bundleId)
        .order("sort_order", { ascending: true });
      if (fetchError) throw fetchError;

      if (!items || items.length === 0) {
        throw new Error("Bundle has no chores to assign");
      }

      // Create an assignment for each chore in the bundle
      const assignments = items.map((item) => ({
        chore_id: item.chore_id,
        household_id: householdId!,
        assigned_to: params.memberId,
        due_date: params.dueDate,
        due_time: params.dueTime || null,
        status: "pending" as const,
        checklist_progress: [],
      }));

      const { error: assignError } = await supabase
        .from("assignments")
        .insert(assignments);
      if (assignError) throw assignError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["bundles"] });
      toast.success("Bundle assigned!");
    },
    onError: (e) => toast.error("Failed to assign bundle: " + e.message),
  });

  return {
    bundles,
    isLoading,
    createBundle,
    updateBundle,
    deleteBundle,
    assignBundle,
  };
}
