"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { QuickTask, QuickTaskInsert } from "@/lib/supabase/types";

export function useQuickTasks() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Fetch tasks ----
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ["quick-tasks", householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("quick_tasks")
        .select("id, household_id, title, is_completed, completed_by, completed_at, created_by, created_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as QuickTask[];
    },
    enabled: !!householdId,
  });

  // ---- Create task ----
  const createTask = useMutation({
    mutationFn: async (
      input: Omit<QuickTaskInsert, "household_id">
    ) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("quick_tasks")
        .insert({
          ...input,
          household_id: householdId,
        })
        .select()
        .single();
      if (error) throw error;
      return data as QuickTask;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-tasks"] });
    },
    onError: (error) => {
      toast.error("Failed to create task: " + error.message);
    },
  });

  // ---- Toggle complete ----
  const toggleTask = useMutation({
    mutationFn: async (params: {
      taskId: string;
      completed: boolean;
      memberId: string;
    }) => {
      const { error } = await supabase
        .from("quick_tasks")
        .update({
          is_completed: params.completed,
          completed_by: params.completed ? params.memberId : null,
          completed_at: params.completed ? new Date().toISOString() : null,
        })
        .eq("id", params.taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-tasks"] });
    },
    onError: (error) => {
      toast.error("Failed to update task: " + error.message);
    },
  });

  // ---- Delete task ----
  const deleteTask = useMutation({
    mutationFn: async (taskId: string) => {
      const { error } = await supabase
        .from("quick_tasks")
        .delete()
        .eq("id", taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["quick-tasks"] });
      toast.success("Task deleted");
    },
    onError: (error) => {
      toast.error("Failed to delete task: " + error.message);
    },
  });

  // ---- Derived ----
  const incomplete = tasks.filter((t) => !t.is_completed);
  const completed = tasks.filter((t) => t.is_completed);

  return {
    tasks,
    incomplete,
    completed,
    isLoading,
    createTask,
    toggleTask,
    deleteTask,
  };
}
