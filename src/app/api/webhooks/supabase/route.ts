import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// Verify Supabase webhook signature
// ---------------------------------------------------------------------------
function verifyWebhookSignature(
  payload: string,
  signature: string | null,
  secret: string | undefined
): boolean {
  // Reject if no secret configured — require it in all environments
  if (!secret) return false;
  if (!signature) return false;

  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(payload);
  const digest = hmac.digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(signature));
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();

    // Verify webhook signature
    const signature = request.headers.get("x-supabase-signature");
    if (
      !verifyWebhookSignature(
        rawBody,
        signature,
        process.env.SUPABASE_WEBHOOK_SECRET
      )
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const payload = JSON.parse(rawBody);
    const supabase = createServiceClient();

    const { type, table, record, old_record } = payload;

    switch (table) {
      case "completions":
        if (type === "INSERT") {
          // Push notification for new completions handled via cron/check-overdue
        }
        break;
      case "assignments":
        if (
          type === "UPDATE" &&
          record.status === "overdue" &&
          old_record?.status !== "overdue"
        ) {
          // Overdue notifications handled via cron/check-overdue
        }
        break;
    }

    return NextResponse.json({ received: true });
  } catch {
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
