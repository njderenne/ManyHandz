"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import type { ActivityFeedItem, ActivityReactions, Member } from "@/lib/supabase/types";

/** Activity feed item with joined member data */
type ActivityWithMember = ActivityFeedItem & { members: Member | null };

export function useActivityFeed(limit = 20) {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  const { data: activities = [], isLoading } = useQuery({
    queryKey: ["activity-feed", householdId, limit],
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("activity_feed")
        .select("*, members(*)")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false })
        .limit(limit);
      return data || [];
    },
    enabled: !!householdId,
  });

  const addReaction = useMutation({
    mutationFn: async ({ activityId, emoji, memberId }: { activityId: string; emoji: string; memberId: string }) => {
      const activity = activities.find((a) => a.id === activityId);
      if (!activity) return;
      const reactions: ActivityReactions = (activity as ActivityWithMember).reactions || {};
      const emojiReactions: string[] = reactions[emoji] || [];
      const updated = emojiReactions.includes(memberId)
        ? emojiReactions.filter((id: string) => id !== memberId)
        : [...emojiReactions, memberId];

      const { error } = await supabase.from("activity_feed")
        .update({ reactions: { ...reactions, [emoji]: updated } })
        .eq("id", activityId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["activity-feed"] }),
  });

  return { activities, isLoading, addReaction };
}
