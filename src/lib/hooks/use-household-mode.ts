"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { createClient } from "@/lib/supabase/client";
import { useMembers } from "./use-members";
import { modeConfigs } from "@/lib/constants/modes";
import type { HouseholdMode } from "@/lib/supabase/types";

export function useHouseholdMode() {
  const activeHouseholdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { currentMember } = useMembers();

  // Fetch only the household mode — lightweight query instead of
  // fetching the full member + household join (eliminates the redundant
  // ["member-context"] query that duplicated member data from useMembers)
  const { data: householdMode } = useQuery({
    queryKey: ["household-mode", activeHouseholdId],
    staleTime: 5 * 60 * 1000, // household mode rarely changes
    queryFn: async () => {
      if (!activeHouseholdId) return null;
      const supabase = createClient();
      const { data } = await supabase
        .from("households")
        .select("mode")
        .eq("id", activeHouseholdId)
        .single();
      return (data?.mode as HouseholdMode) || "family";
    },
    enabled: !!activeHouseholdId,
  });

  return useMemo(() => {
    const mode: HouseholdMode = householdMode || "family";
    const role = currentMember?.role || "roommate";
    const config = modeConfigs[mode] || modeConfigs.family;
    const permissions = config.permissions[role] || config.permissions[config.creatorRole];
    const features = config.features;
    const ui = config.ui;
    const navTabs = config.navTabs[role] || config.navTabs[config.creatorRole];

    return {
      mode,
      role,
      config,
      permissions,
      features,
      ui,
      navTabs,
      memberId: currentMember?.id || null,
      memberData: currentMember,
      isAdmin: permissions?.canEditHouseholdSettings ?? false,
    };
  }, [householdMode, currentMember]);
}
