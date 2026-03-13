"use client";

import { useState, useMemo, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  format,
  isToday,
  isPast,
  parseISO,
  startOfDay,
} from "date-fns";
import {
  CalendarCheck2,
  CheckCircle2,
  Flame,
  Plus,
  AlertTriangle,
  Activity,
  Trophy,
  Star,
  Target,
  TrendingUp,
  Send,
  Loader2,
  Scale,
  Sparkles,
  ClipboardList,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAuth } from "@/lib/hooks/use-auth";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useAssignments } from "@/lib/hooks/use-assignments";
import { useMembers } from "@/lib/hooks/use-members";
import { useActivityFeed } from "@/lib/hooks/use-activity-feed";
import { useSubscription } from "@/lib/hooks/use-subscription";
import { useTimerStore } from "@/lib/stores/timer-store";
import { useUIStore } from "@/lib/stores/ui-store";
import { AssignmentCard } from "@/components/assignments/assignment-card";
import { CompletionModal } from "@/components/assignments/completion-modal";
import { ChorePresetSelector } from "@/components/onboarding/chore-preset-selector";
import { useChores } from "@/lib/hooks/use-chores";
import { useAddPresetChores } from "@/lib/hooks/use-add-preset-chores";
import { getLevelTitle, getLevelProgress, getXpForNextLevel } from "@/lib/constants/levels";
import type { Assignment, Chore, Member, Household } from "@/lib/supabase/types";

/** Member data with joined household from useHouseholdMode */
type MemberWithHousehold = Member & { households: Household | null };

/** Assignment with joined chore + member data from useAssignments */
type AssignmentWithJoins = Assignment & { chores: Chore | null; members: Member | null };

// ---------------------------------------------------------------------------
// Activity Feed Reaction Emojis
// ---------------------------------------------------------------------------

const REACTION_EMOJIS = ["👍", "❤️", "🔥", "⭐", "👏"] as const;

// ---------------------------------------------------------------------------
// Action descriptions for activity types
// ---------------------------------------------------------------------------

function getActivityDescription(item: any): string {
  const actionMap: Record<string, string> = {
    chore_completed: "completed a chore",
    chore_assigned: "was assigned a chore",
    chore_swapped: "swapped a chore",
    reward_redeemed: "redeemed a reward",
    member_joined: "joined the household",
    achievement_earned: "earned an achievement",
    streak_milestone: "hit a streak milestone",
    goal_progress: "made goal progress",
    goal_completed: "completed a goal",
    level_up: "leveled up",
    points_gifted: "gifted points",
    challenge_completed: "completed a challenge",
    competition_completed: "finished a competition",
    quick_task_completed: "completed a quick task",
  };
  return actionMap[item.action_type] ?? item.action_type.replace(/_/g, " ");
}

// ---------------------------------------------------------------------------
// Dashboard Loading Skeleton
// ---------------------------------------------------------------------------

function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6">
      {/* Greeting skeleton */}
      <div className="space-y-1">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-40" />
      </div>

      {/* Stats bar skeleton */}
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>

      {/* Assignments skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-36 rounded-xl" />
        ))}
      </div>

      {/* Activity skeleton */}
      <div className="space-y-3">
        <Skeleton className="h-6 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Stats Bar
// ---------------------------------------------------------------------------

function QuickStatsBar({
  dueToday,
  completedToday,
  streak,
  showPoints,
  points,
}: {
  dueToday: number;
  completedToday: number;
  streak: number;
  showPoints: boolean;
  points: number;
}) {
  return (
    <div className={cn("grid gap-3", showPoints ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}>
      <Card className="py-3">
        <CardContent className="flex items-center gap-3 py-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10">
            <CalendarCheck2 className="size-4 text-blue-500" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none">{dueToday}</p>
            <p className="text-[11px] text-muted-foreground">Due Today</p>
          </div>
        </CardContent>
      </Card>

      <Card className="py-3">
        <CardContent className="flex items-center gap-3 py-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-green-500/10">
            <CheckCircle2 className="size-4 text-green-500" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none">{completedToday}</p>
            <p className="text-[11px] text-muted-foreground">Completed</p>
          </div>
        </CardContent>
      </Card>

      <Card className="py-3">
        <CardContent className="flex items-center gap-3 py-0">
          <div className="flex size-9 items-center justify-center rounded-lg bg-orange-500/10">
            <Flame className="size-4 text-orange-500" />
          </div>
          <div>
            <p className="text-2xl font-bold leading-none">{streak}</p>
            <p className="text-[11px] text-muted-foreground">Day Streak</p>
          </div>
        </CardContent>
      </Card>

      {showPoints && (
        <Card className="py-3">
          <CardContent className="flex items-center gap-3 py-0">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10">
              <Star className="size-4 text-amber-500" />
            </div>
            <div>
              <p className="text-2xl font-bold leading-none">{points}</p>
              <p className="text-[11px] text-muted-foreground">Points</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Trial Banner
// ---------------------------------------------------------------------------

function TrialBanner({
  daysRemaining,
  onDismiss,
}: {
  daysRemaining: number;
  onDismiss: () => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-amber-500" />
        <span>
          <span className="font-medium">{daysRemaining} days</span> left in your
          free trial.
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" asChild>
          <Link href="/settings/billing">Upgrade</Link>
        </Button>
        <button
          onClick={onDismiss}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          Dismiss
        </button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Kid-mode Level Hero
// ---------------------------------------------------------------------------

function LevelHero({ member }: { member: Member }) {
  const level = member.current_level;
  const title = getLevelTitle(level);
  const progressPct = getLevelProgress(member.total_xp, level);
  const nextLevelXp = getXpForNextLevel(level);

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-primary/10 py-4">
      <CardContent className="flex items-center gap-4">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/20 text-2xl font-bold text-primary">
          {level}
        </div>
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <p className="font-semibold">{title}</p>
            <Badge variant="secondary" className="text-[10px]">
              Lvl {level}
            </Badge>
          </div>
          <Progress value={progressPct} className="h-2" />
          <p className="text-[11px] text-muted-foreground">
            {member.total_xp} / {nextLevelXp} XP to next level
          </p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-amber-500">{member.points_balance}</p>
          <p className="text-[10px] text-muted-foreground">Points</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Fairness Mini-Widget (Roommate)
// ---------------------------------------------------------------------------

function FairnessWidget({ members }: { members: Member[] }) {
  if (members.length === 0) return null;

  const totalXp = members.reduce((acc, m) => acc + m.total_xp, 0);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Scale className="size-4" />
          Fairness
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.slice(0, 4).map((m) => {
          const pct =
            totalXp > 0
              ? Math.round((m.total_xp / totalXp) * 100)
              : Math.round(100 / members.length);
          return (
            <div key={m.id} className="flex items-center gap-2">
              <Avatar size="sm">
                {m.avatar_url && (
                  <AvatarImage src={m.avatar_url} alt={m.display_name} />
                )}
                <AvatarFallback>
                  {m.display_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="truncate">{m.display_name}</span>
                  <span className="font-mono text-muted-foreground">{pct}%</span>
                </div>
                <Progress value={pct} className="mt-1 h-1" />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Activity Feed Item
// ---------------------------------------------------------------------------

function ActivityItem({
  item,
  members,
  currentMemberId,
  onReact,
}: {
  item: any;
  members: Member[];
  currentMemberId: string | null;
  onReact: (activityId: string, emoji: string) => void;
}) {
  const member = members.find((m) => m.id === item.member_id);
  const reactions: Record<string, string[]> = item.reactions || {};

  return (
    <div className="flex gap-3 py-2">
      <Avatar size="sm">
        {member?.avatar_url && (
          <AvatarImage src={member.avatar_url} alt={member?.display_name} />
        )}
        <AvatarFallback>
          {member?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1 min-w-0">
        <p className="text-sm">
          <span className="font-medium">{member?.display_name ?? "Someone"}</span>{" "}
          <span className="text-muted-foreground">
            {getActivityDescription(item)}
          </span>
        </p>
        <p className="text-[11px] text-muted-foreground">
          {format(parseISO(item.created_at), "h:mm a")}
        </p>
        {/* Reaction bar */}
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => {
            const reactors: string[] = reactions[emoji] ?? [];
            const hasReacted =
              currentMemberId ? reactors.includes(currentMemberId) : false;
            return (
              <button
                key={emoji}
                onClick={() => onReact(item.id, emoji)}
                className={cn(
                  "inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-xs transition-colors",
                  hasReacted
                    ? "border-primary/30 bg-primary/10"
                    : "border-transparent hover:bg-muted"
                )}
              >
                <span>{emoji}</span>
                {reactors.length > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {reactors.length}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick Add Chore Widget
// ---------------------------------------------------------------------------

function QuickAddWidget({ memberId }: { memberId: string | null }) {
  const [value, setValue] = useState("");
  const [isSending, setIsSending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!value.trim() || !memberId) return;
    setIsSending(true);
    // This would post to an API endpoint for quick tasks
    toast.success(`Quick task "${value.trim()}" created`);
    setValue("");
    setIsSending(false);
  };

  return (
    <Card>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="Quick add a task..."
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={!value.trim() || isSending}
          >
            {isSending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Send className="size-4" />
            )}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Approval Queue Card (Family Parent)
// ---------------------------------------------------------------------------

function ApprovalQueueCard({ count }: { count: number }) {
  if (count === 0) return null;

  return (
    <Link href="/approvals">
      <Card className="border-amber-500/30 bg-amber-500/5 transition-shadow hover:shadow-md">
        <CardContent className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-500/20">
            <CheckCircle2 className="size-5 text-amber-600" />
          </div>
          <div className="flex-1">
            <p className="font-medium">Approval Queue</p>
            <p className="text-xs text-muted-foreground">
              {count} completion{count !== 1 ? "s" : ""} waiting for review
            </p>
          </div>
          <Badge className="bg-amber-500 text-white">{count}</Badge>
        </CardContent>
      </Card>
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Main Dashboard Page
// ---------------------------------------------------------------------------

export default function DashboardPage() {
  const supabase = createClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { profile } = useAuth();
  const {
    mode,
    role,
    permissions,
    features,
    ui,
    memberId,
    memberData,
  } = useHouseholdMode();
  const { members, currentMember, isLoading: membersLoading } = useMembers();
  // Parents/admins see all assignments; kids/colleagues only see their own
  const shouldFilterByMember = role === "kid" || role === "colleague";
  const { assignments: allAssignments, isLoading: assignmentsLoading, completeAssignment } = useAssignments(
    shouldFilterByMember && memberId ? { memberId } : undefined
  );
  const assignments = allAssignments;
  const { activities, isLoading: activitiesLoading, addReaction } = useActivityFeed(10);
  const { chores, isLoading: choresLoading } = useChores();
  const addPresetChores = useAddPresetChores(memberId);
  const { isTrialing, daysRemaining } = useSubscription();
  const trialBannerDismissed = useUIStore((s) => s.trialBannerDismissed);
  const dismissTrialBanner = useUIStore((s) => s.dismissTrialBanner);
  const startTimer = useTimerStore((s) => s.startTimer);

  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [selectedAssignment, setSelectedAssignment] = useState<
    (Assignment & { chores?: Chore | null; members?: Member | null }) | null
  >(null);

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const todayStr = format(new Date(), "yyyy-MM-dd");

  // Filter assignments for today — show only the current member's assignments
  const myTodayAssignments = useMemo(
    () =>
      assignments.filter((a) => {
        const dueDate = a.due_date?.split("T")[0] ?? a.due_date;
        return dueDate === todayStr && a.assigned_to === memberId;
      }),
    [assignments, todayStr, memberId]
  );

  // For task list display, parents see all today's tasks, kids see only their own
  const todayAssignments = useMemo(
    () =>
      assignments.filter((a) => {
        const dueDate = a.due_date?.split("T")[0] ?? a.due_date;
        return dueDate === todayStr;
      }),
    [assignments, todayStr]
  );

  const overdueAssignments = useMemo(
    () =>
      assignments.filter((a) => {
        if (a.status === "completed" || a.status === "skipped") return false;
        const dueDate = a.due_date?.split("T")[0] ?? a.due_date;
        return dueDate < todayStr && a.assigned_to === memberId;
      }),
    [assignments, todayStr, memberId]
  );

  // Stats always show the current member's counts
  const completedTodayCount = useMemo(
    () => myTodayAssignments.filter((a) => a.status === "completed").length,
    [myTodayAssignments]
  );

  // Fetch actual pending approval count from completions table
  const { data: pendingApprovalCount = 0 } = useQuery({
    queryKey: ["approval-count", householdId],
    queryFn: async () => {
      if (!householdId) return 0;
      const { data } = await supabase
        .from("completions")
        .select("id, assignments!inner(household_id)")
        .eq("status", "pending_approval")
        .eq("needs_approval", true)
        .eq("assignments.household_id", householdId);
      return data?.length ?? 0;
    },
    enabled: !!householdId,
  });

  const isParent = mode === "family" && role === "parent";
  const isKid = mode === "family" && role === "kid";
  const isRoommate = mode === "roommate";
  const canAddChore = permissions.canCreateChores;

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleStart = useCallback(
    (assignmentId: string) => {
      const assignment = assignments.find((a) => a.id === assignmentId);
      if (!assignment) return;
      const chore = (assignment as AssignmentWithJoins).chores;
      startTimer({
        assignmentId,
        choreId: chore?.id ?? "",
        choreName: chore?.name ?? "Unknown",
        startedAt: Date.now(),
        estimatedMinutes: chore?.estimated_minutes ?? 15,
      });
      toast.success("Timer started! Get going!");
    },
    [assignments, startTimer]
  );

  const handleComplete = useCallback(
    (assignmentId: string) => {
      const assignment = assignments.find((a) => a.id === assignmentId);
      if (!assignment) return;
      setSelectedAssignment(assignment as AssignmentWithJoins);
      setCompletionModalOpen(true);
    },
    [assignments]
  );

  const handleCompletionSubmit = useCallback(
    (data: {
      assignmentId: string;
      notes?: string;
      beforePhotoUrl?: string;
      afterPhotoUrl?: string;
      actualMinutes?: number;
      pointsEarned: number;
      speedBonus: number;
    }) => {
      const chore = selectedAssignment?.chores;
      const household = (memberData as MemberWithHousehold | null | undefined)?.households;

      completeAssignment.mutate(
        {
          assignmentId: data.assignmentId,
          memberId: currentMember?.id ?? "",
          notes: data.notes,
          beforePhotoUrl: data.beforePhotoUrl,
          afterPhotoUrl: data.afterPhotoUrl,
          actualMinutes: data.actualMinutes,
          needsApproval:
            features.approvalWorkflow &&
            isKid &&
            (chore?.requires_approval ?? true),
          pointsEarned: data.pointsEarned,
          speedBonus: data.speedBonus,
        },
        {
          onSuccess: (completionData) => {
            // Auto-trigger AI verification if enabled and photos provided
            if (
              chore?.ai_verification_enabled &&
              household?.ai_verification_enabled &&
              data.beforePhotoUrl &&
              data.afterPhotoUrl
            ) {
              fetch("/api/ai/verify-completion", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  completionId: completionData.id,
                  beforePhotoUrl: data.beforePhotoUrl,
                  afterPhotoUrl: data.afterPhotoUrl,
                  referencePhotoUrl: chore.reference_photo_url ?? undefined,
                  choreName: chore.name,
                  choreDescription: chore.description ?? undefined,
                }),
              }).catch(console.error);
            }

            setCompletionModalOpen(false);
            setSelectedAssignment(null);
          },
        }
      );
    },
    [completeAssignment, currentMember, features.approvalWorkflow, isKid, selectedAssignment, memberData]
  );

  const handleReaction = useCallback(
    (activityId: string, emoji: string) => {
      if (!memberId) return;
      addReaction.mutate({ activityId, emoji, memberId });
    },
    [addReaction, memberId]
  );

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  if (membersLoading || assignmentsLoading) {
    return <DashboardSkeleton />;
  }

  // -----------------------------------------------------------------------
  // Greeting
  // -----------------------------------------------------------------------

  const displayName =
    currentMember?.display_name ??
    profile?.full_name ??
    "there";
  const hour = new Date().getHours();
  const greeting =
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6 p-4 pb-24 sm:p-6">
      {/* Trial Banner */}
      <AnimatePresence>
        {isTrialing && !trialBannerDismissed && daysRemaining !== null && (
          <TrialBanner
            daysRemaining={daysRemaining}
            onDismiss={dismissTrialBanner}
          />
        )}
      </AnimatePresence>

      {/* Greeting */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {greeting}, {displayName}
          {ui.tonePlayful && " ✨"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), "EEEE, MMMM d, yyyy")}
        </p>
      </div>

      {/* Empty state: no chores yet — show preset selector */}
      {!choresLoading && chores.length === 0 && canAddChore && (
        <ChorePresetSelector
          onSubmit={(templates) =>
            addPresetChores.mutate(templates, {
              onSuccess: ({ count }) => {
                toast.success(`Added ${count} chores to your household!`);
              },
            })
          }
          onSkip={() => {}}
          isSubmitting={addPresetChores.isPending}
          showSkip={false}
        />
      )}

      {/* Kid-mode Level Hero */}
      {isKid && currentMember && <LevelHero member={currentMember} />}

      {/* Quick Stats Bar */}
      <QuickStatsBar
        dueToday={myTodayAssignments.filter((a: any) => a.status !== "completed" && a.status !== "skipped").length}
        completedToday={completedTodayCount}
        streak={currentMember?.current_streak ?? 0}
        showPoints={features.gamification}
        points={currentMember?.points_balance ?? 0}
      />

      {/* Approval Queue (Parent only) */}
      {isParent && <ApprovalQueueCard count={pendingApprovalCount} />}

      {/* Fairness Widget (Roommate only) */}
      {isRoommate && features.fairnessScoring && (
        <FairnessWidget members={members} />
      )}

      {/* Overdue Section */}
      {overdueAssignments.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-red-500" />
            <h2 className="font-semibold text-red-600 dark:text-red-400">
              Overdue ({overdueAssignments.length})
            </h2>
          </div>
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {overdueAssignments.map((assignment: any) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  onStart={handleStart}
                  onComplete={handleComplete}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {/* Today's Assignments */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">
            Today&apos;s Tasks
            {todayAssignments.length > 0 && (
              <span className="ml-2 text-sm text-muted-foreground">
                ({todayAssignments.length})
              </span>
            )}
          </h2>
          {canAddChore && (
            <Button variant="ghost" size="xs" asChild className="gap-1">
              <Link href="/chores/new">
                <Plus className="size-3" />
                New Chore
              </Link>
            </Button>
          )}
        </div>

        {todayAssignments.length === 0 ? (
          <Card className="py-8">
            <CardContent className="flex flex-col items-center justify-center gap-3 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-muted">
                <ClipboardList className="size-7 text-muted-foreground" />
              </div>
              <div>
                <p className="font-medium">
                  {ui.tonePlayful ? "All clear for today!" : "No tasks for today"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {ui.tonePlayful
                    ? "You're free to relax -- or get ahead!"
                    : "Check back later or create new tasks."}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            <AnimatePresence mode="popLayout">
              {todayAssignments.map((assignment: any) => (
                <AssignmentCard
                  key={assignment.id}
                  assignment={assignment}
                  onStart={handleStart}
                  onComplete={handleComplete}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Quick Add Widget removed -- stub was showing success without creating tasks */}

      {/* Activity Feed */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <Activity className="size-4 text-muted-foreground" />
          <h2 className="font-semibold">Activity</h2>
        </div>

        {activitiesLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : activities.length === 0 ? (
          <Card className="py-6">
            <CardContent className="text-center">
              <p className="text-sm text-muted-foreground">
                No activity yet. Complete a chore to get things started!
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="divide-y">
              {activities.map((item: any) => (
                <ActivityItem
                  key={item.id}
                  item={item}
                  members={members}
                  currentMemberId={memberId}
                  onReact={handleReaction}
                />
              ))}
            </CardContent>
          </Card>
        )}
      </div>

      {/* Floating Action Button (Parent / Roommate) */}
      {canAddChore && (
        <Link href="/chores/new">
          <motion.div
            className="fixed bottom-20 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg sm:bottom-6 sm:right-6"
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.95 }}
          >
            <Plus className="size-6" />
          </motion.div>
        </Link>
      )}

      {/* Completion Modal */}
      <CompletionModal
        open={completionModalOpen}
        onOpenChange={setCompletionModalOpen}
        assignment={selectedAssignment}
        currentMember={currentMember ?? null}
        onSubmit={handleCompletionSubmit}
        isSubmitting={completeAssignment.isPending}
      />
    </div>
  );
}
