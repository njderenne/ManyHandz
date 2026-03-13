"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type { HouseholdPoll, PollOption, PollVotes } from "@/lib/supabase/types";

export type PollWithCreator = HouseholdPoll & {
  creator: Record<string, unknown>;
};

export function usePolls() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: polls = [], isLoading } = useQuery({
    queryKey: ["polls", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];
      const { data, error } = await supabase
        .from("household_polls")
        .select("*, creator:members!created_by(*)")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as PollWithCreator[];
    },
    enabled: !!householdId,
  });

  const activePolls = polls.filter(
    (p) =>
      !p.is_closed &&
      (!p.closes_at || new Date(p.closes_at) > new Date())
  );

  const closedPolls = polls.filter(
    (p) =>
      p.is_closed ||
      (p.closes_at && new Date(p.closes_at) <= new Date())
  );

  const createPoll = useMutation({
    mutationFn: async (poll: {
      question: string;
      options: PollOption[];
      allow_multiple: boolean;
      is_anonymous: boolean;
      closes_at?: string;
      created_by: string;
    }) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("household_polls")
        .insert({
          household_id: householdId,
          question: poll.question,
          options: poll.options,
          votes: {} as PollVotes,
          allow_multiple: poll.allow_multiple,
          is_anonymous: poll.is_anonymous,
          is_closed: false,
          closes_at: poll.closes_at || null,
          created_by: poll.created_by,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["polls"] });
      toast.success("Poll created!");
    },
    onError: (e) => toast.error("Failed to create poll: " + e.message),
  });

  const vote = useMutation({
    mutationFn: async ({
      pollId,
      optionId,
      memberId,
    }: {
      pollId: string;
      optionId: string;
      memberId: string;
    }) => {
      const { data: poll, error: fetchError } = await supabase
        .from("household_polls")
        .select("votes, allow_multiple, is_closed, closes_at")
        .eq("id", pollId)
        .single();
      if (fetchError || !poll) throw new Error("Poll not found");

      // Check if poll is still open
      if (
        poll.is_closed ||
        (poll.closes_at && new Date(poll.closes_at) <= new Date())
      ) {
        throw new Error("This poll is closed");
      }

      const votes = (poll.votes || {}) as PollVotes;

      if (!poll.allow_multiple) {
        // Remove member from all other options first (single-choice)
        for (const key of Object.keys(votes)) {
          votes[key] = (votes[key] || []).filter(
            (id: string) => id !== memberId
          );
        }
      }

      // Toggle vote on the selected option
      const optionVotes = votes[optionId] || [];
      if (optionVotes.includes(memberId)) {
        votes[optionId] = optionVotes.filter(
          (id: string) => id !== memberId
        );
      } else {
        votes[optionId] = [...optionVotes, memberId];
      }

      const { error } = await supabase
        .from("household_polls")
        .update({ votes })
        .eq("id", pollId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["polls"] });
    },
    onError: (e) => toast.error("Failed to vote: " + e.message),
  });

  const closePoll = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("household_polls")
        .update({ is_closed: true })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["polls"] });
      toast.success("Poll closed.");
    },
    onError: (e) => toast.error("Failed to close poll: " + e.message),
  });

  const deletePoll = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("household_polls")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["polls"] });
      toast.success("Poll deleted.");
    },
    onError: (e) => toast.error("Failed to delete poll: " + e.message),
  });

  return {
    polls,
    activePolls,
    closedPolls,
    isLoading,
    createPoll,
    vote,
    closePoll,
    deletePoll,
  };
}
