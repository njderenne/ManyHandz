"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";
import type {
  Settlement,
  SettlementInsert,
  SettlementPayoutType,
  SettlementVia,
  Member,
} from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Extended type: Settlement row joined with from/to member data
// ---------------------------------------------------------------------------
export interface SettlementWithMembers extends Settlement {
  from_member: Member;
  to_member: Member;
}

// ---------------------------------------------------------------------------
// Balance helpers
// ---------------------------------------------------------------------------
export interface MemberPairBalance {
  memberA: string;
  memberB: string;
  netCents: number; // positive => A owes B
  nonMoneyCountAtoB: number;
  nonMoneyCountBtoA: number;
  pendingItems: SettlementWithMembers[];
}

function buildBalances(
  settlements: SettlementWithMembers[]
): MemberPairBalance[] {
  const pairMap = new Map<string, MemberPairBalance>();

  const key = (a: string, b: string) =>
    a < b ? `${a}::${b}` : `${b}::${a}`;

  for (const s of settlements) {
    if (s.status !== "pending") continue;

    const k = key(s.from_member_id, s.to_member_id);
    if (!pairMap.has(k)) {
      pairMap.set(k, {
        memberA: s.from_member_id < s.to_member_id ? s.from_member_id : s.to_member_id,
        memberB: s.from_member_id < s.to_member_id ? s.to_member_id : s.from_member_id,
        netCents: 0,
        nonMoneyCountAtoB: 0,
        nonMoneyCountBtoA: 0,
        pendingItems: [],
      });
    }

    const bal = pairMap.get(k)!;
    bal.pendingItems.push(s);

    if (s.payout_type === "money" && s.amount_cents) {
      // from owes to
      if (s.from_member_id === bal.memberA) {
        bal.netCents += s.amount_cents;
      } else {
        bal.netCents -= s.amount_cents;
      }
    } else {
      if (s.from_member_id === bal.memberA) {
        bal.nonMoneyCountAtoB++;
      } else {
        bal.nonMoneyCountBtoA++;
      }
    }
  }

  return Array.from(pairMap.values());
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------
export function useSettlements(filter?: SettlementPayoutType | "all") {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const queryClient = useQueryClient();

  // ---- Fetch settlements for the household (pending + last 90 days) ----
  const { data: settlements = [], isLoading } = useQuery({
    queryKey: ["settlements", householdId],
    staleTime: 2 * 60 * 1000, // 2 min
    queryFn: async () => {
      if (!householdId) return [];

      // Fetch all pending settlements (unbounded — these need attention)
      const { data: pending, error: pendingError } = await supabase
        .from("settlements")
        .select(
          "*, from_member:members!from_member_id(*), to_member:members!to_member_id(*)"
        )
        .eq("household_id", householdId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (pendingError) throw pendingError;

      // Fetch resolved settlements from last 90 days only
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 90);
      const { data: resolved, error: resolvedError } = await supabase
        .from("settlements")
        .select(
          "*, from_member:members!from_member_id(*), to_member:members!to_member_id(*)"
        )
        .eq("household_id", householdId)
        .neq("status", "pending")
        .gte("created_at", cutoff.toISOString())
        .order("created_at", { ascending: false });
      if (resolvedError) throw resolvedError;

      return [...(pending || []), ...(resolved || [])] as SettlementWithMembers[];
    },
    enabled: !!householdId,
  });

  // ---- Derived: filter by payout type ----
  const filtered =
    !filter || filter === "all"
      ? settlements
      : settlements.filter((s) => s.payout_type === filter);

  const pending = filtered.filter((s) => s.status === "pending");
  const settled = filtered.filter(
    (s) => s.status === "settled" || s.status === "forgiven"
  );

  // ---- Derived: balances ----
  const balances = buildBalances(settlements);

  // ---- Create a new settlement ----
  const createSettlement = useMutation({
    mutationFn: async (
      input: Omit<SettlementInsert, "household_id" | "status" | "settled_via" | "settled_note">
    ) => {
      if (!householdId) throw new Error("No household selected");
      const { data, error } = await supabase
        .from("settlements")
        .insert({
          ...input,
          household_id: householdId,
          status: "pending",
          settled_via: null,
          settled_note: null,
        })
        .select(
          "*, from_member:members!from_member_id(*), to_member:members!to_member_id(*)"
        )
        .single();
      if (error) throw error;
      return data as SettlementWithMembers;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      toast.success("Settlement created");
    },
    onError: (error) => {
      toast.error("Failed to create settlement: " + error.message);
    },
  });

  // ---- Mark a settlement as settled ----
  const settleSettlement = useMutation({
    mutationFn: async (params: {
      settlementId: string;
      via: SettlementVia;
      note?: string;
    }) => {
      const { data, error } = await supabase
        .from("settlements")
        .update({
          status: "settled",
          settled_at: new Date().toISOString(),
          settled_via: params.via,
          settled_note: params.note || null,
        })
        .eq("id", params.settlementId)
        .select()
        .single();
      if (error) throw error;
      return data as Settlement;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      toast.success("Marked as settled!");
    },
    onError: (error) => {
      toast.error("Failed to settle: " + error.message);
    },
  });

  // ---- Forgive a settlement ----
  const forgiveSettlement = useMutation({
    mutationFn: async (params: {
      settlementId: string;
      note?: string;
    }) => {
      const { data, error } = await supabase
        .from("settlements")
        .update({
          status: "forgiven",
          settled_at: new Date().toISOString(),
          settled_note: params.note || null,
        })
        .eq("id", params.settlementId)
        .select()
        .single();
      if (error) throw error;
      return data as Settlement;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settlements"] });
      toast.success("Settlement forgiven");
    },
    onError: (error) => {
      toast.error("Failed to forgive: " + error.message);
    },
  });

  return {
    settlements: filtered,
    allSettlements: settlements,
    pending,
    settled,
    balances,
    isLoading,
    createSettlement,
    settleSettlement,
    forgiveSettlement,
  };
}
