"use client";

import { useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Target,
  Plus,
  ShieldOff,
  Trophy,
  Clock,
  CheckCircle,
  XCircle,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { GoalCard } from "@/components/goals/goal-card";

import type { Goal, Member } from "@/lib/supabase/types";

export default function GoalsPage() {
  const router = useRouter();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { features, permissions, isAdmin } = useHouseholdMode();
  const { members, currentMember, isLoading: membersLoading } = useMembers();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ["goals", householdId],
    queryFn: async () => {
      if (!householdId) return [];
      const { data } = await supabase
        .from("goals")
        .select("id, household_id, member_id, title, description, icon, target_points, current_points, monetary_value, auto_contribute_enabled, auto_contribute_percentage, status, completed_at, approved_by, approved_at, created_by, created_at, updated_at")
        .eq("household_id", householdId)
        .order("created_at", { ascending: false });
      return (data || []) as Goal[];
    },
    enabled: !!householdId,
  });

  const pendingGoals = useMemo(
    () => goals.filter((g) => g.status === "pending_approval"),
    [goals]
  );
  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === "active"),
    [goals]
  );
  const completedGoals = useMemo(
    () => goals.filter((g) => g.status === "completed"),
    [goals]
  );

  const memberMap = useMemo(() => {
    const map: Record<string, Member> = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  // Approve a pending goal (parent only)
  const approveGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      if (!currentMember) throw new Error("Not logged in");
      const { error } = await supabase
        .from("goals")
        .update({
          status: "active" as const,
          approved_by: currentMember.id,
          approved_at: new Date().toISOString(),
        })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal approved!");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (err) => {
      toast.error("Failed to approve: " + err.message);
    },
  });

  // Reject a pending goal (parent only)
  const rejectGoalMutation = useMutation({
    mutationFn: async (goalId: string) => {
      const { error } = await supabase
        .from("goals")
        .update({ status: "canceled" as const })
        .eq("id", goalId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Goal declined.");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
    },
    onError: (err) => {
      toast.error("Failed to reject: " + err.message);
    },
  });

  // Contribute points to a goal (atomic via Postgres RPC — prevents race conditions)
  const contributeMutation = useMutation({
    mutationFn: async ({
      goalId,
      points,
    }: {
      goalId: string;
      points: number;
    }) => {
      if (!currentMember) throw new Error("Not logged in");

      const { error } = await supabase.rpc("contribute_to_goal", {
        p_member_id: currentMember.id,
        p_goal_id: goalId,
        p_points: points,
      });
      if (error) {
        throw new Error(error.message.includes("Insufficient") ? "Not enough points" : error.message);
      }
    },
    onSuccess: () => {
      toast.success("Points contributed!");
      queryClient.invalidateQueries({ queryKey: ["goals"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err) => {
      toast.error(err.message);
    },
  });

  const isLoading = membersLoading || goalsLoading;

  // Feature gate: goals only in family mode (placed after all hooks to satisfy Rules of Hooks)
  if (!features.goals) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 p-6">
        <ShieldOff className="h-16 w-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold">Goals are available in Family mode</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Savings goals let kids earn points toward real rewards. Switch to
          Family mode to enable this feature.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 md:p-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-64 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Target className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Goals</h1>
          {activeGoals.length > 0 && (
            <Badge variant="secondary">{activeGoals.length} active</Badge>
          )}
        </div>
        {(isAdmin || permissions.canContributeToOwnGoals) && (
          <Button onClick={() => router.push("/goals/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Goal
          </Button>
        )}
      </div>

      {/* Pending Approval (parent only) */}
      {isAdmin && pendingGoals.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-400" />
            Pending Approval
            <Badge variant="outline" className="ml-1 border-amber-400/50 text-amber-400">
              {pendingGoals.length}
            </Badge>
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {pendingGoals.map((goal) => (
              <Card key={goal.id} className="border-amber-400/30 bg-amber-400/5">
                <CardContent className="pt-4 space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="font-semibold">{goal.title}</p>
                      {goal.description && (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {goal.description}
                        </p>
                      )}
                    </div>
                    <Badge variant="outline" className="text-[10px] border-amber-400/50 text-amber-400 shrink-0">
                      Pending
                    </Badge>
                  </div>

                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>
                      For: <strong className="text-foreground">
                        {memberMap[goal.member_id]?.display_name ?? "Unknown"}
                      </strong>
                    </span>
                    <span>{goal.target_points} pts</span>
                  </div>

                  {goal.monetary_value != null && Number(goal.monetary_value) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Value: ${(Number(goal.monetary_value) / 100).toFixed(2)}
                    </p>
                  )}

                  <div className="flex gap-2 pt-1">
                    <Button
                      size="sm"
                      className="flex-1 gap-1"
                      onClick={() => approveGoalMutation.mutate(goal.id)}
                      disabled={approveGoalMutation.isPending || rejectGoalMutation.isPending}
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1 gap-1"
                      onClick={() => rejectGoalMutation.mutate(goal.id)}
                      disabled={approveGoalMutation.isPending || rejectGoalMutation.isPending}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Decline
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Separator className="mt-4" />
        </div>
      )}

      {/* Pending notice for kids */}
      {!isAdmin && pendingGoals.length > 0 && (
        <Card className="border-amber-400/30 bg-amber-400/5">
          <CardContent className="py-4 flex items-center gap-3">
            <Clock className="h-5 w-5 text-amber-400 shrink-0" />
            <div>
              <p className="text-sm font-medium">
                {pendingGoals.length} goal{pendingGoals.length > 1 ? "s" : ""} waiting for parent approval
              </p>
              <p className="text-xs text-muted-foreground">
                Your parent will review and approve your goal{pendingGoals.length > 1 ? "s" : ""} soon.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Active Goals */}
      <div>
        <h2 className="text-lg font-semibold mb-4">Active Goals</h2>
        {activeGoals.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Target className="h-10 w-10 mx-auto mb-2 opacity-50" />
              <p>No active goals yet.</p>
              <p className="text-xs mt-1">
                Create a goal to start saving points toward something awesome.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {activeGoals.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                member={memberMap[goal.member_id]}
                currentMemberPoints={currentMember?.points_balance ?? 0}
                onContribute={(goalId, points) =>
                  contributeMutation.mutate({ goalId, points })
                }
                isContributing={contributeMutation.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Completed Goals */}
      {completedGoals.length > 0 && (
        <>
          <Separator />
          <div>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-400" />
              Completed Goals
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {completedGoals.map((goal) => (
                <GoalCard
                  key={goal.id}
                  goal={goal}
                  member={memberMap[goal.member_id]}
                  currentMemberPoints={0}
                  onContribute={() => {}}
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
