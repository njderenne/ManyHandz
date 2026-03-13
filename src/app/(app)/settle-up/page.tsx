"use client";

import { useState } from "react";
import {
  HandCoins,
  Plus,
  DollarSign,
  Gift,
  Crown,
  Ticket,
  Pencil,
  UtensilsCrossed,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils/cn";
import { useSettlements } from "@/lib/hooks/use-settlements";
import { useMembers } from "@/lib/hooks/use-members";
import { BalanceSummary } from "@/components/settle-up/balance-summary";
import { SettlementCard } from "@/components/settle-up/settlement-card";
import type {
  SettlementPayoutType,
  SettlementSourceType,
  SettlementVia,
} from "@/lib/supabase/types";

type FilterTab = "all" | SettlementPayoutType;

const FILTER_TABS: { value: FilterTab; label: string; icon: React.ReactNode }[] = [
  { value: "all", label: "All", icon: <HandCoins className="h-3.5 w-3.5" /> },
  { value: "money", label: "Money", icon: <DollarSign className="h-3.5 w-3.5" /> },
  { value: "treat", label: "Treats", icon: <UtensilsCrossed className="h-3.5 w-3.5" /> },
  { value: "privilege", label: "Privileges", icon: <Crown className="h-3.5 w-3.5" /> },
  { value: "experience", label: "Experiences", icon: <Ticket className="h-3.5 w-3.5" /> },
];

export default function SettleUpPage() {
  const [activeTab, setActiveTab] = useState<FilterTab>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const {
    pending,
    settled,
    balances,
    isLoading,
    createSettlement,
    settleSettlement,
    forgiveSettlement,
  } = useSettlements(activeTab === "all" ? undefined : activeTab);

  const { members, currentMember, isLoading: membersLoading } = useMembers();

  // ---- Create form state ----
  const [formFrom, setFormFrom] = useState("");
  const [formTo, setFormTo] = useState("");
  const [formType, setFormType] = useState<SettlementPayoutType>("money");
  const [formAmount, setFormAmount] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formPayoutDesc, setFormPayoutDesc] = useState("");
  const [formSource, setFormSource] = useState<SettlementSourceType>("manual");

  function handleCreateSubmit() {
    if (!formFrom || !formTo || !formDescription) return;
    if (!currentMember) return;

    createSettlement.mutate(
      {
        from_member_id: formFrom,
        to_member_id: formTo,
        payout_type: formType,
        amount_cents:
          formType === "money" ? Math.round(parseFloat(formAmount) * 100) : null,
        payout_description:
          formType !== "money" ? formPayoutDesc || null : null,
        description: formDescription,
        source_type: formSource,
        source_id: null,
        created_by: currentMember.id,
      },
      {
        onSuccess: () => {
          setCreateOpen(false);
          resetForm();
        },
      }
    );
  }

  function resetForm() {
    setFormFrom("");
    setFormTo("");
    setFormType("money");
    setFormAmount("");
    setFormDescription("");
    setFormPayoutDesc("");
    setFormSource("manual");
  }

  function handleSettle(settlementId: string, via: string, note?: string) {
    settleSettlement.mutate({
      settlementId,
      via: via as SettlementVia,
      note,
    });
  }

  function handleForgive(settlementId: string, note?: string) {
    forgiveSettlement.mutate({
      settlementId,
      note,
    });
  }

  if (isLoading || membersLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-36" />
        </div>
        <Skeleton className="h-32 rounded-xl" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <HandCoins className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Settle Up</h1>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-1" />
              Create Settlement
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Create Settlement</DialogTitle>
              <DialogDescription>
                Record a new obligation between household members.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* From */}
              <div className="space-y-2">
                <Label>From (who owes)</Label>
                <Select value={formFrom} onValueChange={setFormFrom}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* To */}
              <div className="space-y-2">
                <Label>To (who is owed)</Label>
                <Select value={formTo} onValueChange={setFormTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {members
                      .filter((m) => m.id !== formFrom)
                      .map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.display_name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Type */}
              <div className="space-y-2">
                <Label>Payout Type</Label>
                <Select
                  value={formType}
                  onValueChange={(v) =>
                    setFormType(v as SettlementPayoutType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="money">Money</SelectItem>
                    <SelectItem value="treat">Treat</SelectItem>
                    <SelectItem value="gift">Gift</SelectItem>
                    <SelectItem value="privilege">Privilege</SelectItem>
                    <SelectItem value="experience">Experience</SelectItem>
                    <SelectItem value="custom">Custom</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Amount (money only) */}
              {formType === "money" && (
                <div className="space-y-2">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                  />
                </div>
              )}

              {/* Payout description (non-money) */}
              {formType !== "money" && (
                <div className="space-y-2">
                  <Label>What is owed?</Label>
                  <Input
                    placeholder="e.g. Ice cream trip, Extra screen time"
                    value={formPayoutDesc}
                    onChange={(e) => setFormPayoutDesc(e.target.value)}
                  />
                </div>
              )}

              {/* Description */}
              <div className="space-y-2">
                <Label>Description</Label>
                <Textarea
                  placeholder="Why is this owed?"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  rows={2}
                />
              </div>

              {/* Source */}
              <div className="space-y-2">
                <Label>Source</Label>
                <Select
                  value={formSource}
                  onValueChange={(v) =>
                    setFormSource(v as SettlementSourceType)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="goal_payout">Goal Payout</SelectItem>
                    <SelectItem value="competition">Competition</SelectItem>
                    <SelectItem value="reward_redemption">
                      Reward Redemption
                    </SelectItem>
                    <SelectItem value="allowance">Allowance</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateSubmit}
                disabled={
                  !formFrom ||
                  !formTo ||
                  !formDescription ||
                  (formType === "money" && !formAmount) ||
                  createSettlement.isPending
                }
              >
                <Plus className="h-4 w-4 mr-1" />
                Create
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {/* Balance Summary */}
      <BalanceSummary balances={balances} />

      {/* Filter Tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as FilterTab)}
      >
        <TabsList className="w-full sm:w-auto">
          {FILTER_TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>

        {/* All tab contents use the same filtered data */}
        {FILTER_TABS.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="space-y-6">
            {/* Pending */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                Pending
                {pending.length > 0 && (
                  <Badge variant="default" className="text-xs">
                    {pending.length}
                  </Badge>
                )}
              </h2>
              {pending.length === 0 ? (
                <Card>
                  <CardContent className="py-8 text-center text-muted-foreground">
                    No pending settlements
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {pending.map((s) => (
                    <SettlementCard
                      key={s.id}
                      settlement={s}
                      currentMemberId={currentMember?.id ?? null}
                      onSettle={handleSettle}
                      onForgive={handleForgive}
                    />
                  ))}
                </div>
              )}
            </div>

            <Separator />

            {/* Settled History */}
            <div className="space-y-3">
              <h2 className="text-lg font-semibold text-muted-foreground">
                History
              </h2>
              {settled.length === 0 ? (
                <Card>
                  <CardContent className="py-6 text-center text-muted-foreground text-sm">
                    No settled items yet
                  </CardContent>
                </Card>
              ) : (
                <div className="space-y-3">
                  {settled.map((s) => (
                    <SettlementCard
                      key={s.id}
                      settlement={s}
                      currentMemberId={currentMember?.id ?? null}
                      onSettle={handleSettle}
                      onForgive={handleForgive}
                    />
                  ))}
                </div>
              )}
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
