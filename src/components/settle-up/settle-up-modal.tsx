"use client";

import { useState } from "react";
import {
  ExternalLink,
  Check,
  HeartHandshake,
  Wallet,
  CreditCard,
  Banknote,
  Smartphone,
  HandCoins,
  MoreHorizontal,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils/cn";
import { formatCurrency } from "@/lib/utils/format";
import {
  getPaymentLink,
  getSupportedPlatforms,
} from "@/lib/utils/payment-links";
import type { SettlementWithMembers } from "@/lib/hooks/use-settlements";
import type { SettlementVia } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Payment method config
// ---------------------------------------------------------------------------
interface PaymentMethod {
  key: SettlementVia;
  label: string;
  icon: React.ReactNode;
}

const PAYMENT_METHODS: PaymentMethod[] = [
  { key: "venmo", label: "Venmo", icon: <Wallet className="h-4 w-4" /> },
  { key: "paypal", label: "PayPal", icon: <CreditCard className="h-4 w-4" /> },
  { key: "cashapp", label: "Cash App", icon: <Banknote className="h-4 w-4" /> },
  { key: "apple_cash", label: "Apple Cash", icon: <Smartphone className="h-4 w-4" /> },
  { key: "cash", label: "Cash", icon: <HandCoins className="h-4 w-4" /> },
  { key: "in_person", label: "In Person", icon: <Check className="h-4 w-4" /> },
  { key: "other", label: "Other", icon: <MoreHorizontal className="h-4 w-4" /> },
];

// Map settlement via keys to payment link platform keys
const VIA_TO_PLATFORM: Record<string, string> = {
  venmo: "venmo",
  paypal: "paypal",
  cashapp: "cashapp",
  apple_cash: "apple_cash",
};

// Map settlement via keys to member handle fields
const VIA_TO_HANDLE_FIELD: Record<string, keyof typeof HANDLE_FIELDS> = {
  venmo: "venmo_handle",
  paypal: "paypal_handle",
  cashapp: "cashapp_handle",
  apple_cash: "apple_cash_phone",
};

const HANDLE_FIELDS = {
  venmo_handle: true,
  paypal_handle: true,
  cashapp_handle: true,
  apple_cash_phone: true,
} as const;

interface SettleUpModalProps {
  settlement: SettlementWithMembers;
  action: "settle" | "forgive";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSettle: (settlementId: string, via: string, note?: string) => void;
  onForgive: (settlementId: string, note?: string) => void;
}

export function SettleUpModal({
  settlement,
  action,
  open,
  onOpenChange,
  onSettle,
  onForgive,
}: SettleUpModalProps) {
  const [selectedVia, setSelectedVia] = useState<SettlementVia>("cash");
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);

  const isMoney = settlement.payout_type === "money";

  function handleConfirm() {
    setConfirming(true);
    if (action === "settle") {
      onSettle(settlement.id, selectedVia, note || undefined);
    } else {
      onForgive(settlement.id, note || undefined);
    }
    onOpenChange(false);
    setConfirming(false);
  }

  // Build deep-link for the selected payment method
  function getDeepLink() {
    const platform = VIA_TO_PLATFORM[selectedVia];
    if (!platform) return null;

    const handleField = VIA_TO_HANDLE_FIELD[selectedVia];
    if (!handleField) return null;

    const handle = settlement.to_member[handleField as keyof typeof settlement.to_member] as string | null | undefined;
    if (!handle) return null;

    const amount =
      settlement.amount_cents ? settlement.amount_cents / 100 : undefined;

    return getPaymentLink(platform, handle, amount, settlement.description);
  }

  const deepLink = isMoney ? getDeepLink() : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {action === "settle" ? "Settle Up" : "Forgive Settlement"}
          </DialogTitle>
          <DialogDescription>
            {action === "settle"
              ? `Mark "${settlement.description}" as fulfilled.`
              : `Forgive the obligation for "${settlement.description}".`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Settlement info */}
          <div className="rounded-lg bg-muted/50 p-3 space-y-1">
            <p className="text-sm font-medium">{settlement.description}</p>
            {isMoney && settlement.amount_cents && (
              <p className="text-lg font-bold">
                {formatCurrency(settlement.amount_cents)}
              </p>
            )}
            {!isMoney && settlement.payout_description && (
              <p className="text-sm text-muted-foreground">
                {settlement.payout_description}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {settlement.from_member.display_name} owes{" "}
              {settlement.to_member.display_name}
            </p>
          </div>

          {/* Settle flow */}
          {action === "settle" && (
            <>
              {isMoney && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Payment Method</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {PAYMENT_METHODS.map((method) => (
                        <button
                          key={method.key}
                          type="button"
                          onClick={() => setSelectedVia(method.key)}
                          className={cn(
                            "flex items-center gap-2 rounded-lg border p-2.5 text-sm transition-colors",
                            selectedVia === method.key
                              ? "border-primary bg-primary/10 text-primary"
                              : "border-border hover:border-primary/50"
                          )}
                        >
                          {method.icon}
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Deep link button */}
                  {deepLink && deepLink.url && (
                    <Button
                      variant="outline"
                      className="w-full"
                      asChild
                    >
                      <a
                        href={deepLink.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open {deepLink.platform}
                      </a>
                    </Button>
                  )}
                  {deepLink && !deepLink.url && deepLink.fallbackUrl && (
                    <Button
                      variant="outline"
                      className="w-full"
                      asChild
                    >
                      <a
                        href={deepLink.fallbackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <ExternalLink className="h-4 w-4 mr-2" />
                        Open {deepLink.platform} (Web)
                      </a>
                    </Button>
                  )}
                </>
              )}

              <div className="space-y-2">
                <Label htmlFor="settle-note">Note (optional)</Label>
                <Textarea
                  id="settle-note"
                  placeholder={
                    isMoney
                      ? "e.g. Sent via Venmo"
                      : "e.g. Gave the ice cream trip!"
                  }
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />
              </div>
            </>
          )}

          {/* Forgive flow */}
          {action === "forgive" && (
            <div className="space-y-2">
              <Label htmlFor="forgive-note">Note (optional)</Label>
              <Textarea
                id="forgive-note"
                placeholder="e.g. Don't worry about it!"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
              />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={confirming}
            variant={action === "forgive" ? "secondary" : "default"}
          >
            {action === "settle" ? (
              <>
                <Check className="h-4 w-4 mr-1" />
                {isMoney ? "Mark as Paid" : "Mark as Fulfilled"}
              </>
            ) : (
              <>
                <HeartHandshake className="h-4 w-4 mr-1" />
                Forgive
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
