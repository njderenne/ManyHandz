import { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/utils/env";
import { rateLimitAuth, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimitAuth(ip);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const { email } = await request.json();
    const supabase = createServiceClient();

    // Find user by email
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("email", email)
      .single();

    // Return the same generic error for both "user not found" and "no passkeys"
    // to prevent email enumeration attacks
    if (!profile) {
      return NextResponse.json(
        { error: "No passkeys available for this account" },
        { status: 400 }
      );
    }

    const { data: credentials } = await supabase
      .from("webauthn_credentials")
      .select("id, transports")
      .eq("user_id", profile.id);

    if (!credentials?.length) {
      return NextResponse.json(
        { error: "No passkeys available for this account" },
        { status: 400 }
      );
    }

    const options = await generateAuthenticationOptions({
      rpID: env.WEBAUTHN_RP_ID,
      allowCredentials: credentials.map((c) => ({
        id: c.id,
        transports: (c.transports || []) as AuthenticatorTransportFuture[],
      })),
      userVerification: "preferred",
    });

    await supabase.from("webauthn_challenges").insert({
      user_id: profile.id,
      challenge: options.challenge,
      type: "authentication",
    });

    // NOTE: userId intentionally NOT returned to client — login-verify
    // derives it from the stored credential to prevent session hijacking.
    return NextResponse.json(options);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
