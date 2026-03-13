"use client";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";

export function useSubscription() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);

  const { data: subscription, isLoading } = useQuery({
    queryKey: ["subscription", householdId],
    staleTime: 5 * 60 * 1000, // 5 minutes — only changes on billing events
    queryFn: async () => {
      if (!householdId) return null;
      const { data } = await supabase
        .from("subscriptions")
        .select("id, status, trial_end, current_period_end, stripe_subscription_id, price_id, cancel_at_period_end")
        .eq("household_id", householdId)
        .single();
      return data;
    },
    enabled: !!householdId,
  });

  const isActive = subscription?.status === "active" || subscription?.status === "trialing";
  const isTrialing = subscription?.status === "trialing";
  const trialEndsAt = subscription?.trial_end ? new Date(subscription.trial_end) : null;
  const daysRemaining = trialEndsAt
    ? Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;

  return { subscription, isActive, isTrialing, trialEndsAt, daysRemaining, isLoading };
}
