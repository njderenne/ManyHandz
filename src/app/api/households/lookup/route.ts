import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { rateLimitLookup, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";

/**
 * Look up a household by invite code.
 * Uses the service-role client to bypass RLS — new users who aren't
 * members yet need to be able to find households by invite code.
 */
export async function GET(request: NextRequest) {
  const ip = getClientIp(request);
  const rl = rateLimitLookup(ip);
  if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

  const code = request.nextUrl.searchParams.get("code");

  if (!code || code.length < 6 || code.length > 10) {
    return NextResponse.json(
      { error: "Invalid invite code" },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data, error } = await supabase
    .from("households")
    .select("id, name, mode")
    .eq("invite_code", code.toUpperCase())
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "No household found with this invite code" },
      { status: 404 }
    );
  }

  return NextResponse.json({ household: data });
}
