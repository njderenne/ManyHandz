// ============================================================================
// ManyHandz — Server-Side Push Notification Sender
// Uses web-push to deliver notifications to subscribed devices.
// Automatically cleans up stale/invalid subscriptions on failure.
// ============================================================================

import webpush from "web-push";
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/utils/env";

let vapidInitialized = false;

function ensureVapid() {
  if (vapidInitialized) return;
  webpush.setVapidDetails(
    "mailto:support@manyhandz.com",
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  vapidInitialized = true;
}

export interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  tag?: string;
  data?: Record<string, string>;
  actions?: Array<{ action: string; title: string }>;
}

/**
 * Sends a push notification to all devices registered by a specific user.
 * Automatically removes subscriptions that are no longer valid (expired,
 * unsubscribed, or otherwise rejected by the push service).
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload
): Promise<void> {
  ensureVapid();
  const supabase = createServiceClient();

  const { data: subscriptions } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  if (!subscriptions?.length) return;

  const results = await Promise.allSettled(
    subscriptions.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload)
      )
    )
  );

  // Clean up invalid subscriptions (410 Gone, 404, or other push errors)
  for (let i = 0; i < results.length; i++) {
    if (results[i].status === "rejected") {
      await supabase
        .from("push_subscriptions")
        .delete()
        .eq("id", subscriptions[i].id);
    }
  }
}

/**
 * Sends a push notification to all active members of a household.
 * Optionally excludes a specific user (e.g. the actor who triggered the event).
 */
export async function sendPushToHousehold(
  householdId: string,
  payload: PushPayload,
  excludeUserId?: string
): Promise<void> {
  const supabase = createServiceClient();

  const { data: members } = await supabase
    .from("members")
    .select("user_id")
    .eq("household_id", householdId)
    .eq("is_active", true);

  if (!members) return;

  await Promise.allSettled(
    members
      .filter((m) => m.user_id !== excludeUserId)
      .map((m) => sendPushToUser(m.user_id, payload))
  );
}
