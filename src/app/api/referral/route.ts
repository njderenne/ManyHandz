// ============================================================================
// ManyHandz -- Referral API Route
// POST: Generate a referral code for the current user's household
// GET:  Retrieve referral stats (codes generated, successful referrals)
// ============================================================================

import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

function generateReferralCode(): string {
  return `MH-${randomBytes(4).toString("hex").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// POST - Generate referral code
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const householdId = body.householdId as string | undefined;

    if (!householdId) {
      return NextResponse.json(
        { error: "householdId is required" },
        { status: 400 }
      );
    }

    // Verify the user belongs to this household
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("household_id", householdId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!member) {
      return NextResponse.json(
        { error: "You are not a member of this household" },
        { status: 403 }
      );
    }

    // Check if there's already an active referral code for this household
    const serviceClient = createServiceClient();
    const { data: existingCode } = await serviceClient
      .from("referral_codes")
      .select("id, referrer_household_id, code, uses, max_uses, is_active, created_at")
      .eq("referrer_household_id", householdId)
      .eq("is_active", true)
      .single();

    if (existingCode) {
      return NextResponse.json({
        success: true,
        code: existingCode,
        message: "Existing active referral code found",
      });
    }

    // Generate a new unique referral code
    const code = generateReferralCode();

    const { data: newCode, error: insertError } = await serviceClient
      .from("referral_codes")
      .insert({
        referrer_household_id: householdId,
        code,
        uses: 0,
        max_uses: 10,
        is_active: true,
      })
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      code: newCode,
      message: "Referral code generated",
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------------
// GET - Get referral stats
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const householdId = searchParams.get("householdId");

    if (!householdId) {
      return NextResponse.json(
        { error: "householdId is required" },
        { status: 400 }
      );
    }

    // Verify membership
    const { data: member } = await supabase
      .from("members")
      .select("id")
      .eq("household_id", householdId)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (!member) {
      return NextResponse.json(
        { error: "You are not a member of this household" },
        { status: 403 }
      );
    }

    const serviceClient = createServiceClient();

    // Fetch all referral codes for this household
    const { data: codes, error: codesError } = await serviceClient
      .from("referral_codes")
      .select("id, code, uses, max_uses, is_active, created_at")
      .eq("referrer_household_id", householdId)
      .order("created_at", { ascending: false });

    if (codesError) throw codesError;

    const allCodes = codes || [];
    const activeCodes = allCodes.filter((c) => c.is_active);

    // Fetch all redemptions for these codes
    const codeIds = allCodes.map((c) => c.id);
    let redemptions: any[] = [];

    if (codeIds.length > 0) {
      const { data: redemptionData, error: redemptionsError } =
        await serviceClient
          .from("referral_redemptions")
          .select("id, referral_code_id, referrer_credit_applied")
          .in("referral_code_id", codeIds);

      if (redemptionsError) throw redemptionsError;
      redemptions = redemptionData || [];
    }

    const successfulReferrals = redemptions.filter(
      (r) => r.referrer_credit_applied
    ).length;

    return NextResponse.json({
      success: true,
      stats: {
        totalCodesGenerated: allCodes.length,
        activeCodesCount: activeCodes.length,
        totalRedemptions: redemptions.length,
        successfulReferrals,
        codes: allCodes.map((c) => ({
          id: c.id,
          code: c.code,
          uses: c.uses,
          maxUses: c.max_uses,
          isActive: c.is_active,
          createdAt: c.created_at,
        })),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
