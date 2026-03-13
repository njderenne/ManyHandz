"use client";

import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreditCard, AlertCircle, Clock, CheckCircle } from "lucide-react";
import type { Subscription } from "@/lib/supabase/types";
import { format } from "date-fns";

/** Only the fields this component actually reads */
type SubscriptionSlice = Pick<
  Subscription,
  "status" | "price_id" | "current_period_end" | "cancel_at_period_end"
>;

interface SubscriptionStatusProps {
  subscription: SubscriptionSlice | null;
  className?: string;
}

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  active: {
    label: "Active",
    variant: "default",
    icon: <CheckCircle className="size-4" />,
  },
  trialing: {
    label: "Trial",
    variant: "secondary",
    icon: <Clock className="size-4" />,
  },
  past_due: {
    label: "Past Due",
    variant: "destructive",
    icon: <AlertCircle className="size-4" />,
  },
  canceled: {
    label: "Canceled",
    variant: "outline",
    icon: <AlertCircle className="size-4" />,
  },
  unpaid: {
    label: "Unpaid",
    variant: "destructive",
    icon: <AlertCircle className="size-4" />,
  },
  incomplete: {
    label: "Incomplete",
    variant: "outline",
    icon: <AlertCircle className="size-4" />,
  },
};

export function SubscriptionStatus({ subscription, className }: SubscriptionStatusProps) {
  if (!subscription) {
    return (
      <Card className={cn("border-[var(--border-default)] bg-[var(--bg-secondary)]", className)}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
            <CreditCard className="size-5" />
            Subscription
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-[var(--text-muted)]">No active subscription</p>
        </CardContent>
      </Card>
    );
  }

  const statusConfig = STATUS_CONFIG[subscription.status] ?? STATUS_CONFIG.active;
  const isMonthly = subscription.price_id?.includes("monthly");
  const planName = isMonthly ? "Monthly" : "Annual";

  return (
    <Card className={cn("border-[var(--border-default)] bg-[var(--bg-secondary)]", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
          <CreditCard className="size-5" />
          Subscription
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-secondary)]">Status</span>
          <Badge variant={statusConfig.variant} className="gap-1">
            {statusConfig.icon}
            {statusConfig.label}
          </Badge>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-secondary)]">Plan</span>
          <span className="text-sm font-medium text-[var(--text-primary)]">
            ManyHandz {planName}
          </span>
        </div>

        {subscription.current_period_end && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-[var(--text-secondary)]">
              {subscription.cancel_at_period_end ? "Access Until" : "Next Billing"}
            </span>
            <span className="text-sm text-[var(--text-primary)]">
              {format(new Date(subscription.current_period_end), "MMM d, yyyy")}
            </span>
          </div>
        )}

        {subscription.cancel_at_period_end && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3">
            <p className="text-xs text-amber-400">
              Your subscription will not renew. You will retain access until the end of the current billing period.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
