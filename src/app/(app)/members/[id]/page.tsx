"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils/cn";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { getLevelSummary } from "@/lib/utils/levels";
import { formatPoints, formatShortDate, formatRelativeDate } from "@/lib/utils/format";
import { getAccentColorByValue } from "@/lib/constants/colors";
import { getLevelTitle } from "@/lib/constants/levels";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { PaymentHandles } from "@/components/members/payment-handles";

import {
  ArrowLeft,
  Gift,
  Flame,
  Calendar,
  Cake,
  Target,
  Trophy,
  BarChart3,
  Moon,
  ShieldCheck,
  UserMinus,
  Loader2,
  Star,
  CheckCircle,
  Clock,
  TrendingUp,
} from "lucide-react";

import type { Member, Goal, ActivityFeedItem } from "@/lib/supabase/types";

const ROLE_LABELS: Record<string, string> = {
  parent: "Parent",
  kid: "Kid",
  roommate: "Roommate",
  manager: "Manager",
  colleague: "Colleague",
};

export default function MemberProfilePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { mode, role, permissions, features, isAdmin, memberId: currentMemberId } = useHouseholdMode();
  const { currentMember } = useMembers();
  const memberId = params.id;

  // -----------------------------------------------------------------------
  // Fetch member
  // -----------------------------------------------------------------------
  const { data: member, isLoading: memberLoading } = useQuery({
    queryKey: ["member", memberId],
    queryFn: async () => {
      const { data } = await supabase
        .from("members")
        .select("id, household_id, user_id, display_name, avatar_url, bio, birthday, favorite_color, role, points_balance, total_xp, current_level, current_streak, longest_streak, venmo_handle, paypal_handle, cashapp_handle, apple_cash_phone, is_active, away_until, away_reason, mute_celebrations, allowance_enabled, allowance_payout_type, allowance_amount_cents, allowance_reward_description, allowance_threshold_pct, joined_at")
        .eq("id", memberId)
        .single();
      return data as Member | null;
    },
    enabled: !!memberId,
  });

  // -----------------------------------------------------------------------
  // Fetch stats: completions this week/month
  // -----------------------------------------------------------------------
  const { data: stats } = useQuery({
    queryKey: ["member-stats", memberId],
    queryFn: async () => {
      if (!memberId || !householdId) return null;
      const now = new Date();
      const weekStart = new Date(now);
      weekStart.setDate(now.getDate() - now.getDay());
      weekStart.setHours(0, 0, 0, 0);
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

      const [weekRes, monthRes, fairnessRes] = await Promise.all([
        supabase
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("completed_by", memberId)
          .gte("completed_at", weekStart.toISOString()),
        supabase
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("completed_by", memberId)
          .gte("completed_at", monthStart.toISOString()),
        supabase
          .from("completions")
          .select("id", { count: "exact", head: true })
          .eq("completed_by", memberId),
      ]);

      // Calculate fairness from total completions across household
      const { count: totalHousehold } = await supabase
        .from("completions")
        .select("id", { count: "exact", head: true })
        .in(
          "completed_by",
          (
            await supabase
              .from("members")
              .select("id")
              .eq("household_id", householdId)
              .eq("is_active", true)
          ).data?.map((m) => m.id) ?? []
        );

      const memberTotal = fairnessRes.count ?? 0;
      const householdTotal = totalHousehold ?? 1;

      const { count: memberCount } = await supabase
        .from("members")
        .select("id", { count: "exact", head: true })
        .eq("household_id", householdId)
        .eq("is_active", true);

      const idealShare = householdTotal / Math.max(memberCount ?? 1, 1);
      const fairnessPct = idealShare > 0 ? Math.min(100, Math.round((memberTotal / idealShare) * 100)) : 100;

      return {
        completionsThisWeek: weekRes.count ?? 0,
        completionsThisMonth: monthRes.count ?? 0,
        fairnessPercentage: fairnessPct,
      };
    },
    enabled: !!memberId && !!householdId,
  });

  // -----------------------------------------------------------------------
  // Fetch goals (family mode)
  // -----------------------------------------------------------------------
  const { data: goals = [] } = useQuery({
    queryKey: ["member-goals", memberId],
    queryFn: async () => {
      if (!memberId) return [];
      const { data } = await supabase
        .from("goals")
        .select("id, household_id, member_id, title, description, icon, target_points, current_points, status, completed_at, created_at")
        .eq("member_id", memberId)
        .eq("status", "active")
        .order("created_at", { ascending: false })
        .limit(5);
      return (data || []) as Goal[];
    },
    enabled: !!memberId && features.goals,
  });

  // -----------------------------------------------------------------------
  // Fetch recent activity
  // -----------------------------------------------------------------------
  const { data: activities = [] } = useQuery({
    queryKey: ["member-activity", memberId],
    queryFn: async () => {
      if (!memberId) return [];
      const { data } = await supabase
        .from("activity_feed")
        .select("id, household_id, member_id, action_type, metadata, reactions, created_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: false })
        .limit(10);
      return (data || []) as ActivityFeedItem[];
    },
    enabled: !!memberId,
  });

  // -----------------------------------------------------------------------
  // Gift Points
  // -----------------------------------------------------------------------
  const [giftAmount, setGiftAmount] = useState("");
  const [giftNote, setGiftNote] = useState("");
  const [giftDialogOpen, setGiftDialogOpen] = useState(false);

  const giftPoints = useMutation({
    mutationFn: async () => {
      if (!currentMemberId || !memberId || !householdId) throw new Error("Missing context");
      const amount = parseInt(giftAmount, 10);
      if (isNaN(amount) || amount <= 0) throw new Error("Invalid amount");

      // Atomic via Postgres RPC — prevents double-spend race conditions
      const { error } = await supabase.rpc("transfer_points", {
        p_from_member_id: currentMemberId,
        p_to_member_id: memberId,
        p_household_id: householdId,
        p_points: amount,
        p_note: giftNote || null,
        p_gift_type: "general",
      });
      if (error) {
        throw new Error(error.message.includes("Insufficient") ? "Insufficient points" : error.message);
      }
    },
    onSuccess: () => {
      toast.success("Points gifted!");
      setGiftDialogOpen(false);
      setGiftAmount("");
      setGiftNote("");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to gift points"),
  });

  // -----------------------------------------------------------------------
  // Admin: Change Role
  // -----------------------------------------------------------------------
  const [newRole, setNewRole] = useState("");

  const changeRole = useMutation({
    mutationFn: async (roleValue: string) => {
      if (!memberId) throw new Error("No member");
      const { error } = await supabase
        .from("members")
        .update({ role: roleValue })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Role updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["member", memberId] });
    },
    onError: () => toast.error("Failed to change role"),
  });

  // -----------------------------------------------------------------------
  // Admin: Remove from Household
  // -----------------------------------------------------------------------
  const removeMember = useMutation({
    mutationFn: async () => {
      if (!memberId) throw new Error("No member");
      const { error } = await supabase
        .from("members")
        .update({ is_active: false })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Member removed from household");
      router.push("/members");
    },
    onError: () => toast.error("Failed to remove member"),
  });

  // -----------------------------------------------------------------------
  // Settle Up
  // -----------------------------------------------------------------------
  const { data: balance } = useQuery({
    queryKey: ["settlement-balance", currentMemberId, memberId],
    queryFn: async () => {
      if (!currentMemberId || !memberId || !householdId) return 0;
      // Net owed: settlements where current user owes this member minus reverse
      const { data: owed } = await supabase
        .from("settlements")
        .select("amount_cents")
        .eq("household_id", householdId)
        .eq("from_member_id", currentMemberId)
        .eq("to_member_id", memberId)
        .eq("status", "pending");

      const { data: reverse } = await supabase
        .from("settlements")
        .select("amount_cents")
        .eq("household_id", householdId)
        .eq("from_member_id", memberId)
        .eq("to_member_id", currentMemberId)
        .eq("status", "pending");

      const owedSum = (owed ?? []).reduce((acc, s) => acc + (s.amount_cents ?? 0), 0);
      const reverseSum = (reverse ?? []).reduce((acc, s) => acc + (s.amount_cents ?? 0), 0);
      return owedSum - reverseSum;
    },
    enabled: !!currentMemberId && !!memberId && currentMemberId !== memberId && !!householdId,
  });

  // -----------------------------------------------------------------------
  // Computed values
  // -----------------------------------------------------------------------
  if (memberLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="size-8 animate-spin text-[var(--text-muted)]" />
      </div>
    );
  }

  if (!member) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4">
        <p className="text-[var(--text-muted)]">Member not found</p>
        <Button variant="outline" onClick={() => router.push("/members")}>
          <ArrowLeft className="size-4 mr-2" />
          Back to Members
        </Button>
      </div>
    );
  }

  const accentColor = getAccentColorByValue(member.favorite_color);
  const initials = member.display_name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
  const isAway = member.away_until && new Date(member.away_until) > new Date();
  const levelInfo = features.gamification ? getLevelSummary(member.total_xp) : null;
  const isOwnProfile = currentMemberId === memberId;
  const isFamilyMode = mode === "family";

  // Calculate age from birthday
  const age = member.birthday
    ? (() => {
        const birthDate = new Date(member.birthday);
        const today = new Date();
        let a = today.getFullYear() - birthDate.getFullYear();
        const monthDiff = today.getMonth() - birthDate.getMonth();
        if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
          a--;
        }
        return a;
      })()
    : null;

  const availableRoles = mode === "family" ? ["parent", "kid"] : mode === "roommate" ? ["roommate"] : ["manager", "colleague"];

  return (
    <div className="mx-auto max-w-2xl space-y-6 pb-24 px-4">
      {/* Back Button */}
      <div className="pt-6">
        <Button
          variant="ghost"
          size="sm"
          className="gap-2 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={() => router.push("/members")}
        >
          <ArrowLeft className="size-4" />
          Back to Members
        </Button>
      </div>

      {/* Profile Header */}
      <Card className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <CardContent className="flex flex-col items-center gap-4 pt-8 pb-6">
          {/* Avatar with colored ring */}
          <div className="relative">
            <Avatar
              className="size-24 ring-4 ring-offset-4 ring-offset-[var(--bg-secondary)]"
              style={{ ["--tw-ring-color" as string]: member.favorite_color }}
            >
              <AvatarImage src={member.avatar_url ?? undefined} alt={member.display_name} />
              <AvatarFallback
                className="text-2xl font-bold text-white"
                style={{ backgroundColor: accentColor?.value ?? member.favorite_color }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            {isAway && (
              <div className="absolute -bottom-1 -right-1 rounded-full bg-amber-500/20 p-1.5">
                <Moon className="size-4 text-amber-400" />
              </div>
            )}
          </div>

          {/* Name & Role */}
          <div className="text-center space-y-1">
            <h2 className="text-xl font-bold text-[var(--text-primary)]">{member.display_name}</h2>
            <Badge variant="outline" className="border-[var(--border-default)] text-[var(--text-muted)]">
              {ROLE_LABELS[member.role] ?? member.role}
            </Badge>
          </div>

          {/* Level / XP Bar */}
          {features.gamification && levelInfo && (
            <div className="w-full max-w-xs space-y-1">
              <div className="flex items-center justify-between text-sm">
                <span className="font-medium text-[var(--accent-primary)]">
                  Level {levelInfo.level} - {levelInfo.title}
                </span>
                <span className="text-xs text-[var(--text-muted)]">
                  {levelInfo.progress.current}/{levelInfo.progress.required} XP
                </span>
              </div>
              <Progress value={levelInfo.progress.percentage} className="h-2" />
            </div>
          )}

          {/* Bio */}
          {member.bio && (
            <p className="text-sm text-[var(--text-secondary)] text-center max-w-sm">
              {member.bio}
            </p>
          )}

          {/* Quick Info Row */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm text-[var(--text-muted)]">
            {age !== null && (
              <span className="flex items-center gap-1">
                <Calendar className="size-3.5" />
                {age} years old
              </span>
            )}
            {member.birthday && (
              <span className="flex items-center gap-1">
                <Cake className="size-3.5" />
                {formatShortDate(member.birthday)}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Calendar className="size-3.5" />
              Joined {formatShortDate(member.joined_at)}
            </span>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            {/* Gift Points */}
            {permissions.canGiftPoints && !isOwnProfile && (
              <Dialog open={giftDialogOpen} onOpenChange={setGiftDialogOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-2 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  >
                    <Gift className="size-4 text-pink-400" />
                    Gift Points
                  </Button>
                </DialogTrigger>
                <DialogContent className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
                  <DialogHeader>
                    <DialogTitle className="text-[var(--text-primary)]">
                      Gift Points to {member.display_name}
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="text-sm text-[var(--text-muted)]">
                      Your balance: {formatPoints(currentMember?.points_balance ?? 0)}
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[var(--text-secondary)]">Amount</Label>
                      <Input
                        type="number"
                        value={giftAmount}
                        onChange={(e) => setGiftAmount(e.target.value)}
                        placeholder="Enter points amount"
                        min={1}
                        max={currentMember?.points_balance ?? 0}
                        className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-[var(--text-secondary)]">Note (optional)</Label>
                      <Input
                        value={giftNote}
                        onChange={(e) => setGiftNote(e.target.value)}
                        placeholder="Thanks for helping out!"
                        className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                      />
                    </div>
                    <Button
                      className="w-full gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                      onClick={() => giftPoints.mutate()}
                      disabled={giftPoints.isPending || !giftAmount}
                    >
                      {giftPoints.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <>
                          <Gift className="size-4" />
                          Send Gift
                        </>
                      )}
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            )}

            {isAway && (
              <Badge variant="secondary" className="bg-amber-500/10 text-amber-400 border-amber-500/30">
                <Moon className="size-3 mr-1" />
                Away
                {member.away_reason && ` - ${member.away_reason}`}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Payment Handles */}
      {features.paymentHandles && (
        <PaymentHandles member={member} />
      )}

      {/* Settle Up */}
      {!isOwnProfile && balance !== undefined && balance !== 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <CardContent className="flex items-center justify-between py-4">
            <div>
              <p className="text-sm font-medium text-[var(--text-primary)]">Settle Up</p>
              <p className={cn("text-sm", balance > 0 ? "text-red-400" : "text-emerald-400")}>
                {balance > 0
                  ? `You owe $${(balance / 100).toFixed(2)}`
                  : `${member.display_name} owes you $${(Math.abs(balance) / 100).toFixed(2)}`}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              onClick={() => router.push(`/settlements?with=${memberId}`)}
            >
              View Settlements
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <Card className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
            <BarChart3 className="size-5 text-[var(--accent-primary)]" />
            Stats
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3 text-center">
              <CheckCircle className="size-5 mx-auto text-emerald-400 mb-1" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{stats?.completionsThisWeek ?? 0}</p>
              <p className="text-xs text-[var(--text-muted)]">This Week</p>
            </div>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3 text-center">
              <Clock className="size-5 mx-auto text-blue-400 mb-1" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{stats?.completionsThisMonth ?? 0}</p>
              <p className="text-xs text-[var(--text-muted)]">This Month</p>
            </div>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3 text-center">
              <Flame className="size-5 mx-auto text-orange-400 mb-1" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{member.current_streak}</p>
              <p className="text-xs text-[var(--text-muted)]">Streak</p>
            </div>
            <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-3 text-center">
              <TrendingUp className="size-5 mx-auto text-violet-400 mb-1" />
              <p className="text-lg font-bold text-[var(--text-primary)]">{stats?.fairnessPercentage ?? 100}%</p>
              <p className="text-xs text-[var(--text-muted)]">Fairness</p>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 text-sm">
            <span className="text-[var(--text-secondary)]">Points</span>
            <span className="font-medium text-[var(--text-primary)]">{formatPoints(member.points_balance)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-secondary)]">Total XP</span>
            <span className="font-medium text-[var(--text-primary)]">{member.total_xp.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-[var(--text-secondary)]">Longest Streak</span>
            <span className="font-medium text-[var(--text-primary)]">{member.longest_streak} days</span>
          </div>
        </CardContent>
      </Card>

      {/* Goals (family mode) */}
      {features.goals && goals.length > 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
              <Target className="size-5 text-emerald-400" />
              Goals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {goals.map((goal) => {
              const progress = goal.target_points > 0
                ? Math.min(100, Math.round((goal.current_points / goal.target_points) * 100))
                : 0;
              return (
                <div key={goal.id} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span>{goal.icon}</span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{goal.title}</span>
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">
                      {goal.current_points}/{goal.target_points} pts
                    </span>
                  </div>
                  <Progress value={progress} className="h-1.5" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Recent Activity */}
      {activities.length > 0 && (
        <Card className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-[var(--text-primary)]">
              <Star className="size-5 text-amber-400" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {activities.map((activity) => (
              <div
                key={activity.id}
                className="flex items-start justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-2.5"
              >
                <div>
                  <p className="text-sm text-[var(--text-primary)]">
                    {activity.action_type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </p>
                  {activity.metadata?.description ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      {String(activity.metadata.description)}
                    </p>
                  ) : null}
                </div>
                <span className="text-xs text-[var(--text-muted)] shrink-0 ml-2">
                  {formatRelativeDate(activity.created_at)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Admin Actions */}
      {isAdmin && !isOwnProfile && (
        <Card className="border-red-500/20 bg-[var(--bg-secondary)]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-400">
              <ShieldCheck className="size-5" />
              Admin Actions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Change Role */}
            {permissions.canChangeMemberRoles && availableRoles.length > 1 && (
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">Change Role</Label>
                <div className="flex items-center gap-2">
                  <Select
                    value={newRole || member.role}
                    onValueChange={setNewRole}
                  >
                    <SelectTrigger className="flex-1 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r] ?? r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    onClick={() => changeRole.mutate(newRole || member.role)}
                    disabled={changeRole.isPending || (!newRole || newRole === member.role)}
                  >
                    {changeRole.isPending ? <Loader2 className="size-4 animate-spin" /> : "Update"}
                  </Button>
                </div>
              </div>
            )}

            <Separator className="bg-[var(--border-default)]" />

            {/* Remove from Household */}
            <div className="space-y-2">
              <p className="text-sm text-[var(--text-muted)]">
                Remove this member from the household. They can rejoin using the invite code.
              </p>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10"
                onClick={() => {
                  if (confirm(`Are you sure you want to remove ${member.display_name} from this household?`)) {
                    removeMember.mutate();
                  }
                }}
                disabled={removeMember.isPending}
              >
                {removeMember.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <>
                    <UserMinus className="size-4" />
                    Remove from Household
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
