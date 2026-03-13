import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/server";
import { createServiceClient } from "@/lib/supabase/service";
import { env } from "@/lib/utils/env";
import type Stripe from "stripe";

function getSubscriptionPeriod(subscription: Stripe.Subscription) {
  // Stripe SDK v20+ may not expose these directly on the type,
  // but the API still returns them. Cast to extract safely.
  const sub = subscription as unknown as Record<string, unknown>;
  const start = sub.current_period_start as number | undefined;
  const end = sub.current_period_end as number | undefined;
  return {
    current_period_start: start
      ? new Date(start * 1000).toISOString()
      : new Date().toISOString(),
    current_period_end: end
      ? new Date(end * 1000).toISOString()
      : new Date().toISOString(),
  };
}

export async function POST(request: Request) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature")!;

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      env.STRIPE_WEBHOOK_SECRET
    );
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = createServiceClient();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.subscription
        ? (
            await stripe.subscriptions.retrieve(
              session.subscription as string
            )
          ).metadata.supabase_user_id
        : session.metadata?.supabase_user_id;

      if (userId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string
        );
        const period = getSubscriptionPeriod(subscription);
        await supabase
          .from("subscriptions")
          .update({
            stripe_subscription_id: subscription.id,
            stripe_customer_id: session.customer as string,
            status: "active",
            price_id: subscription.items.data[0]?.price.id,
            ...period,
          })
          .eq("user_id", userId);
      }
      break;
    }
    case "customer.subscription.updated": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;
      const period = getSubscriptionPeriod(subscription);
      if (userId) {
        await supabase
          .from("subscriptions")
          .update({
            status: subscription.status as string,
            price_id: subscription.items.data[0]?.price.id,
            ...period,
            cancel_at_period_end: subscription.cancel_at_period_end,
          })
          .eq("user_id", userId);
      }
      break;
    }
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      const userId = subscription.metadata.supabase_user_id;
      if (userId) {
        await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
          })
          .eq("user_id", userId);
      }
      break;
    }
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const subId = (invoice as unknown as Record<string, unknown>).subscription as string;
      if (subId) {
        const subscription = await stripe.subscriptions.retrieve(subId);
        const userId = subscription.metadata.supabase_user_id;
        if (userId) {
          await supabase
            .from("subscriptions")
            .update({ status: "past_due" })
            .eq("user_id", userId);
        }
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
