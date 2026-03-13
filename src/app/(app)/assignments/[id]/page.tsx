"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format, parseISO, isPast, isToday } from "date-fns";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock,
  Play,
  Pause,
  Square,
  Image as ImageIcon,
  MessageSquare,
  Send,
  Timer,
  CalendarCheck2,
  AlertTriangle,
  Camera,
  Star,
  BarChart3,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CompletionModal } from "@/components/assignments/completion-modal";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useMembers } from "@/lib/hooks/use-members";
import { useAssignments } from "@/lib/hooks/use-assignments";
import { useTimerStore } from "@/lib/stores/timer-store";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import type {
  Assignment,
  Chore,
  Member,
  Household,
  ChecklistProgressItem,
  AssignmentComment as CommentType,
  Completion,
} from "@/lib/supabase/types";

/** Member data with joined household from useHouseholdMode */
type MemberWithHousehold = Member & { households: Household | null };

// ---------------------------------------------------------------------------
// Status timeline config
// ---------------------------------------------------------------------------

const STATUS_STEPS = [
  { key: "created", label: "Created", icon: CalendarCheck2 },
  { key: "in_progress", label: "Started", icon: Play },
  { key: "completed", label: "Completed", icon: CheckCircle2 },
] as const;

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending", className: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  in_progress: { label: "In Progress", className: "bg-amber-500/10 text-amber-600 dark:text-amber-400" },
  completed: { label: "Completed", className: "bg-green-500/10 text-green-600 dark:text-green-400" },
  overdue: { label: "Overdue", className: "bg-red-500/10 text-red-600 dark:text-red-400" },
  skipped: { label: "Skipped", className: "bg-muted text-muted-foreground" },
  snoozed_pending_approval: { label: "Snoozed", className: "bg-purple-500/10 text-purple-600" },
};

// ---------------------------------------------------------------------------
// Live timer
// ---------------------------------------------------------------------------

function LiveTimerDisplay({ assignmentId }: { assignmentId: string }) {
  const getElapsedMs = useTimerStore((s) => s.getElapsedMs);
  const timers = useTimerStore((s) => s.timers);
  const pauseTimer = useTimerStore((s) => s.pauseTimer);
  const resumeTimer = useTimerStore((s) => s.resumeTimer);
  const timer = timers[assignmentId];
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(getElapsedMs(assignmentId));
    const interval = setInterval(() => {
      setElapsedMs(getElapsedMs(assignmentId));
    }, 1000);
    return () => clearInterval(interval);
  }, [assignmentId, getElapsedMs]);

  if (!timer) return null;

  const totalSeconds = Math.floor(elapsedMs / 1000);
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  const isPaused = !!timer.pausedAt;

  return (
    <Card className="border-amber-500/30 bg-amber-500/5">
      <CardContent className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-full bg-amber-500/20">
            <Timer className={cn("size-5 text-amber-600", !isPaused && "animate-pulse")} />
          </div>
          <div>
            <p className="font-mono text-2xl font-bold">
              {mins.toString().padStart(2, "0")}:{secs.toString().padStart(2, "0")}
            </p>
            <p className="text-xs text-muted-foreground">
              {isPaused ? "Paused" : "Running"} / Est. {timer.estimatedMinutes} min
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isPaused ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => resumeTimer(assignmentId)}
            >
              <Play className="size-4" />
            </Button>
          ) : (
            <Button
              variant="outline"
              size="icon"
              onClick={() => pauseTimer(assignmentId)}
            >
              <Pause className="size-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AssignmentDetailPage() {
  const params = useParams();
  const router = useRouter();
  const assignmentId = params.id as string;

  const supabase = createClient();
  const queryClient = useQueryClient();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { memberId, features, ui, permissions, memberData } = useHouseholdMode();
  const { members, currentMember } = useMembers();
  const { completeAssignment } = useAssignments();
  const startTimer = useTimerStore((s) => s.startTimer);
  const timers = useTimerStore((s) => s.timers);

  const [completionModalOpen, setCompletionModalOpen] = useState(false);
  const [commentText, setCommentText] = useState("");

  // -----------------------------------------------------------------------
  // Fetch assignment
  // -----------------------------------------------------------------------

  const { data: assignment, isLoading: assignmentLoading } = useQuery({
    queryKey: ["assignment-detail", assignmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("assignments")
        .select("*, chores(*), members!assigned_to(*)")
        .eq("id", assignmentId)
        .single();
      return data as (Assignment & { chores?: Chore | null; members?: Member | null }) | null;
    },
    enabled: !!assignmentId,
  });

  // -----------------------------------------------------------------------
  // Fetch completion (if exists)
  // -----------------------------------------------------------------------

  const { data: completion } = useQuery({
    queryKey: ["assignment-completion", assignmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("completions")
        .select("id, assignment_id, completed_by, completed_at, before_photo_url, after_photo_url, extra_photo_urls, notes, points_earned, speed_bonus, actual_minutes, approved_by, approved_at, rejection_reason, needs_approval, ai_verification_id, status")
        .eq("assignment_id", assignmentId)
        .maybeSingle();
      return data as Completion | null;
    },
    enabled: !!assignmentId,
  });

  // -----------------------------------------------------------------------
  // Fetch comments
  // -----------------------------------------------------------------------

  const { data: comments = [], isLoading: commentsLoading } = useQuery({
    queryKey: ["assignment-comments", assignmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("assignment_comments")
        .select("*, members:member_id(*)")
        .eq("assignment_id", assignmentId)
        .order("created_at", { ascending: true });
      return data ?? [];
    },
    enabled: !!assignmentId,
  });

  // -----------------------------------------------------------------------
  // Add comment mutation
  // -----------------------------------------------------------------------

  const addComment = useMutation({
    mutationFn: async (body: string) => {
      const { error } = await supabase.from("assignment_comments").insert({
        assignment_id: assignmentId,
        household_id: householdId!,
        member_id: memberId!,
        body,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignment-comments", assignmentId] });
      setCommentText("");
    },
    onError: (err) => toast.error("Failed to add comment: " + err.message),
  });

  // -----------------------------------------------------------------------
  // Update checklist progress mutation
  // -----------------------------------------------------------------------

  const updateChecklist = useMutation({
    mutationFn: async (progress: ChecklistProgressItem[]) => {
      const { error } = await supabase
        .from("assignments")
        .update({ checklist_progress: progress as unknown as ChecklistProgressItem[] })
        .eq("id", assignmentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["assignment-detail", assignmentId] });
    },
    onError: (err) => {
      toast.error("Failed to update checklist: " + err.message);
    },
  });

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const chore = assignment?.chores;
  const assignee = assignment?.members;
  const hasTimer = !!timers[assignmentId];

  const checklist = useMemo(() => {
    if (!chore?.checklist) return [];
    if (Array.isArray(chore.checklist)) return chore.checklist;
    try {
      return JSON.parse(chore.checklist as unknown as string);
    } catch {
      return [];
    }
  }, [chore?.checklist]);

  const checklistProgress: ChecklistProgressItem[] = useMemo(() => {
    // Parse whatever is stored in the DB
    let stored: ChecklistProgressItem[] = [];
    if (assignment?.checklist_progress) {
      stored = Array.isArray(assignment.checklist_progress)
        ? assignment.checklist_progress
        : JSON.parse(assignment.checklist_progress as unknown as string);
    }

    // Ensure every checklist item has a matching progress entry.
    // Assignments are often created with checklist_progress = [] so the
    // stored array may be empty even though the chore has checklist steps.
    if (checklist.length === 0) return stored;

    const storedMap = new Map(stored.map((p) => [p.id, p]));
    return checklist.map((item: any) => {
      const existing = storedMap.get(item.id);
      return existing ?? { id: item.id, checked: false };
    });
  }, [assignment?.checklist_progress, checklist]);

  const checkedCount = checklistProgress.filter((p) => p.checked).length;
  const checklistPercent =
    checklist.length > 0 ? Math.round((checkedCount / checklist.length) * 100) : 0;

  const isOverdue =
    assignment &&
    assignment.status !== "completed" &&
    assignment.status !== "skipped" &&
    isPast(parseISO(assignment.due_date));

  const effectiveStatus = isOverdue ? "overdue" : assignment?.status ?? "pending";
  const statusBadge = STATUS_BADGE[effectiveStatus] ?? STATUS_BADGE.pending;

  const statusStepIndex = useMemo(() => {
    if (assignment?.status === "completed") return 2;
    if (assignment?.status === "in_progress" || hasTimer) return 1;
    return 0;
  }, [assignment?.status, hasTimer]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------

  const handleStart = useCallback(() => {
    if (!chore || !assignment) return;
    startTimer({
      assignmentId: assignment.id,
      choreId: chore.id,
      choreName: chore.name,
      startedAt: Date.now(),
      estimatedMinutes: chore.estimated_minutes,
    });

    // Update status to in_progress
    supabase
      .from("assignments")
      .update({ status: "in_progress" })
      .eq("id", assignmentId)
      .then(({ error }) => {
        if (error) {
          toast.error("Failed to update status: " + error.message);
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["assignment-detail", assignmentId] });
      });

    toast.success("Timer started!");
  }, [assignment, assignmentId, chore, queryClient, startTimer, supabase]);

  const handleToggleChecklistItem = useCallback(
    (itemId: string) => {
      const updated = checklistProgress.map((p) =>
        p.id === itemId
          ? { ...p, checked: !p.checked, checked_at: !p.checked ? new Date().toISOString() : undefined }
          : p
      );
      updateChecklist.mutate(updated);
    },
    [checklistProgress, updateChecklist]
  );

  const handleCompletionSubmit = useCallback(
    (data: any) => {
      const chore = assignment?.chores;
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
            assignment?.members?.role === "kid" &&
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
              }).catch((err) =>
                console.error("AI verification request failed:", err)
              );
            }

            setCompletionModalOpen(false);
            router.push("/dashboard");
          },
        }
      );
    },
    [assignment, completeAssignment, currentMember, features.approvalWorkflow, memberData, router]
  );

  const handleSubmitComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment.mutate(commentText.trim());
  };

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  if (assignmentLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <Skeleton className="size-9" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    );
  }

  if (!assignment || !chore) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <p className="text-lg font-medium">Assignment not found</p>
        <Button variant="outline" onClick={() => router.push("/dashboard")}>
          Back to Dashboard
        </Button>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-2xl font-bold tracking-tight">
            {chore.name}
          </h1>
          <div className="flex items-center gap-2 mt-1">
            <Badge variant="secondary" className={cn("text-xs", statusBadge.className)}>
              {isOverdue && <AlertTriangle className="mr-0.5 size-3" />}
              {statusBadge.label}
            </Badge>
            <span className="text-xs text-muted-foreground">
              Due {format(parseISO(assignment.due_date), "MMM d, yyyy")}
              {assignment.due_time && ` at ${assignment.due_time}`}
            </span>
          </div>
        </div>
      </div>

      {/* Status Timeline */}
      <Card>
        <CardContent>
          <div className="flex items-center justify-between">
            {STATUS_STEPS.map((step, i) => {
              const StepIcon = step.icon;
              const isActive = i <= statusStepIndex;
              const isCurrent = i === statusStepIndex;
              return (
                <div key={step.key} className="flex flex-1 items-center">
                  <div className="flex flex-col items-center gap-1">
                    <div
                      className={cn(
                        "flex size-8 items-center justify-center rounded-full border-2 transition-colors",
                        isActive
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-muted bg-background text-muted-foreground"
                      )}
                    >
                      <StepIcon className="size-4" />
                    </div>
                    <span
                      className={cn(
                        "text-[10px]",
                        isActive ? "font-medium" : "text-muted-foreground"
                      )}
                    >
                      {step.label}
                    </span>
                  </div>
                  {i < STATUS_STEPS.length - 1 && (
                    <div
                      className={cn(
                        "mx-2 h-0.5 flex-1 rounded-full",
                        i < statusStepIndex ? "bg-primary" : "bg-muted"
                      )}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Timer (when running) */}
      {hasTimer && <LiveTimerDisplay assignmentId={assignmentId} />}

      {/* Assignee Card */}
      <Card>
        <CardContent className="flex items-center gap-3">
          <Avatar>
            {assignee?.avatar_url && (
              <AvatarImage src={assignee.avatar_url} alt={assignee.display_name} />
            )}
            <AvatarFallback>
              {assignee?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <p className="font-medium">{assignee?.display_name ?? "Unassigned"}</p>
            <p className="text-xs text-muted-foreground">Assigned member</p>
          </div>
          {features.gamification && assignee && (
            <div className="text-right">
              <p className="text-sm font-semibold text-amber-500">
                Lvl {assignee.current_level}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {assignee.current_streak} day streak
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reference Photo ("The Goal") */}
      {chore.reference_photo_url && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ImageIcon className="size-4" />
              The Goal
            </CardTitle>
          </CardHeader>
          <CardContent>
            <img
              src={chore.reference_photo_url}
              alt={`Reference for ${chore.name}`}
              className="w-full rounded-lg border object-cover"
            />
          </CardContent>
        </Card>
      )}

      {/* Checklist with checkable steps */}
      {checklist.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-sm">
                <CheckCircle2 className="size-4" />
                Checklist
              </CardTitle>
              <span className="text-xs text-muted-foreground">
                {checkedCount}/{checklist.length} ({checklistPercent}%)
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-1">
            <Progress value={checklistPercent} className="mb-3 h-2" />
            {checklist.map((item: any, i: number) => {
              const progressItem = checklistProgress.find((p) => p.id === item.id);
              const isChecked = progressItem?.checked ?? false;
              return (
                <label
                  key={item.id ?? i}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50",
                    isChecked && "opacity-60"
                  )}
                >
                  <Checkbox
                    checked={isChecked}
                    onCheckedChange={() => handleToggleChecklistItem(item.id)}
                    disabled={assignment.status === "completed"}
                  />
                  <span
                    className={cn(
                      "text-sm",
                      isChecked && "line-through text-muted-foreground"
                    )}
                  >
                    {item.label ?? item.step ?? item}
                  </span>
                </label>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Action Buttons */}
      {assignment.status !== "completed" && assignment.status !== "skipped" && (
        <div className="flex gap-3">
          {(assignment.status === "pending" || isOverdue) && !hasTimer && (
            <Button onClick={handleStart} className="flex-1 gap-2" size="lg">
              <Play className="size-4" />
              Start Timer
            </Button>
          )}
          <Button
            onClick={() => setCompletionModalOpen(true)}
            className="flex-1 gap-2 bg-green-600 hover:bg-green-700"
            size="lg"
          >
            <CheckCircle2 className="size-4" />
            Mark Done
          </Button>
        </div>
      )}

      {/* Photo Proof (after completion) */}
      {completion && (completion.before_photo_url || completion.after_photo_url) && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Camera className="size-4" />
              Photo Proof
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {completion.before_photo_url && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">Before</p>
                  <img
                    src={completion.before_photo_url}
                    alt="Before"
                    className="w-full rounded-lg border object-cover aspect-square"
                  />
                </div>
              )}
              {completion.after_photo_url && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">After</p>
                  <img
                    src={completion.after_photo_url}
                    alt="After"
                    className="w-full rounded-lg border object-cover aspect-square"
                  />
                </div>
              )}
            </div>
            {completion.notes && (
              <div className="mt-3 rounded-md bg-muted/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-1">Notes</p>
                <p className="text-sm">{completion.notes}</p>
              </div>
            )}
            {features.gamification && (
              <div className="mt-3 flex items-center gap-3 text-sm">
                <div className="flex items-center gap-1">
                  <Star className="size-3.5 text-amber-500" />
                  <span className="font-medium">+{completion.points_earned} pts</span>
                </div>
                {completion.speed_bonus > 0 && (
                  <div className="flex items-center gap-1 text-blue-500">
                    <BarChart3 className="size-3.5" />
                    <span>+{completion.speed_bonus} speed bonus</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Comments Thread */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <MessageSquare className="size-4" />
            Comments
            {comments.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {comments.length}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Comments list */}
          {commentsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 2 }).map((_, i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-2">
              No comments yet.
            </p>
          ) : (
            <div className="space-y-3">
              <AnimatePresence mode="popLayout">
                {comments.map((comment: any) => {
                  const commentMember = comment.members;
                  return (
                    <motion.div
                      key={comment.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="flex gap-2.5"
                    >
                      <Avatar size="sm">
                        {commentMember?.avatar_url && (
                          <AvatarImage
                            src={commentMember.avatar_url}
                            alt={commentMember.display_name}
                          />
                        )}
                        <AvatarFallback>
                          {commentMember?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">
                            {commentMember?.display_name ?? "Unknown"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {format(parseISO(comment.created_at), "h:mm a")}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{comment.body}</p>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}

          {/* Add comment form */}
          <form onSubmit={handleSubmitComment} className="flex gap-2 pt-2 border-t">
            <Input
              placeholder="Add a comment..."
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              className="flex-1"
            />
            <Button
              type="submit"
              size="icon"
              disabled={!commentText.trim() || addComment.isPending}
            >
              {addComment.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Completion Modal */}
      <CompletionModal
        open={completionModalOpen}
        onOpenChange={setCompletionModalOpen}
        assignment={assignment}
        currentMember={currentMember ?? null}
        onSubmit={handleCompletionSubmit}
        isSubmitting={completeAssignment.isPending}
      />
    </div>
  );
}
