import { NextResponse } from "next/server";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/utils/env";
import { rateLimitAuth, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";

export async function POST(request: Request) {
  try {
    const ip = getClientIp(request);
    const rl = rateLimitAuth(ip);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const { credential: authResponse } = await request.json();
    const supabase = createServiceClient();

    // SECURITY: Derive userId from the stored credential rather than trusting
    // a client-supplied userId. This prevents an attacker from providing
    // a victim's userId to hijack their session.
    const { data: storedCred } = await supabase
      .from("webauthn_credentials")
      .select("id, user_id, public_key, counter, transports")
      .eq("id", authResponse.id)
      .single();

    if (!storedCred)
      return NextResponse.json(
        { error: "Credential not found" },
        { status: 400 }
      );

    // Now use the trusted user_id from the stored credential
    const userId = storedCred.user_id;

    const { data: challengeRow } = await supabase
      .from("webauthn_challenges")
      .select("challenge")
      .eq("user_id", userId)
      .eq("type", "authentication")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (!challengeRow)
      return NextResponse.json({ error: "No challenge" }, { status: 400 });

    const verification = await verifyAuthenticationResponse({
      response: authResponse,
      expectedChallenge: challengeRow.challenge,
      expectedOrigin: env.WEBAUTHN_ORIGIN,
      expectedRPID: env.WEBAUTHN_RP_ID,
      credential: {
        id: storedCred.id,
        publicKey: Buffer.from(storedCred.public_key, "base64"),
        counter: storedCred.counter,
        transports:
          storedCred.transports as AuthenticatorTransportFuture[],
      },
    });

    if (!verification.verified) {
      return NextResponse.json(
        { error: "Verification failed" },
        { status: 400 }
      );
    }

    // Update counter and last used
    await supabase
      .from("webauthn_credentials")
      .update({
        counter: verification.authenticationInfo.newCounter,
        last_used_at: new Date().toISOString(),
      })
      .eq("id", storedCred.id);

    // Clean up challenges
    await supabase
      .from("webauthn_challenges")
      .delete()
      .eq("user_id", userId)
      .eq("type", "authentication");

    // Get user email for session creation
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", userId)
      .single();

    if (!profile?.email) {
      return NextResponse.json(
        { error: "User profile not found" },
        { status: 400 }
      );
    }

    // Create a Supabase session by generating a magic link token.
    // The client exchanges this token via verifyOtp to establish a proper session.
    const { data: linkData, error: linkError } =
      await supabase.auth.admin.generateLink({
        type: "magiclink",
        email: profile.email,
      });

    if (linkError || !linkData?.properties?.hashed_token) {
      console.error("Failed to generate session link:", linkError);
      return NextResponse.json(
        { error: "Failed to create session" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      verified: true,
      token_hash: linkData.properties.hashed_token,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
