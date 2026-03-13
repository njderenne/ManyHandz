"use client";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import type { Household } from "@/lib/supabase/types";

export function useHouseholds() {
  const supabase = createClient();
  const activeHouseholdId = useHouseholdStore((s) => s.activeHouseholdId);
  const setActiveHousehold = useHouseholdStore((s) => s.setActiveHousehold);

  const { data: households = [], isLoading } = useQuery({
    queryKey: ["households"],
    staleTime: 5 * 60 * 1000, // 5 minutes — households rarely change
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];
      const { data } = await supabase
        .from("members")
        .select("household_id, households(*)")
        .eq("user_id", user.id)
        .eq("is_active", true);
      return (data?.map((m) => m.households).filter(Boolean) || []) as unknown as Household[];
    },
  });

  const activeHousehold = households.find((h) => h.id === activeHouseholdId) || households[0];

  // Auto-select first household (in useEffect to avoid state updates during render)
  useEffect(() => {
    if (households.length > 0 && !activeHouseholdId) {
      setActiveHousehold(households[0]?.id);
    }
  }, [households, activeHouseholdId, setActiveHousehold]);

  return { households, activeHousehold, isLoading, setActiveHousehold };
}
