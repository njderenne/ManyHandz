// ---------------------------------------------------------------------------
// Server-side authorization helpers
// Used by API routes to verify household membership and role permissions.
// ---------------------------------------------------------------------------

import { SupabaseClient } from "@supabase/supabase-js";

/**
 * Verify that the authenticated user is an active member of the given household.
 * Returns the member record if found, or null if the user is not a member.
 */
export async function verifyHouseholdMembership(
  supabase: SupabaseClient,
  userId: string,
  householdId: string
): Promise<{ id: string; role: string } | null> {
  const { data: member } = await supabase
    .from("members")
    .select("id, role")
    .eq("household_id", householdId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .single();

  return member;
}

/**
 * Verify that the authenticated user is an admin (parent or manager) of the household.
 * Returns the member record if authorized, or null otherwise.
 */
export async function verifyHouseholdAdmin(
  supabase: SupabaseClient,
  userId: string,
  householdId: string
): Promise<{ id: string; role: string } | null> {
  const member = await verifyHouseholdMembership(supabase, userId, householdId);
  if (!member || !["parent", "manager"].includes(member.role)) {
    return null;
  }
  return member;
}
