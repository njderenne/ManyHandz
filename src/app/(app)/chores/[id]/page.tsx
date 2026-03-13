"use client";

import { useState, useMemo, useCallback } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  ArrowLeft,
  Star,
  Clock,
  CheckSquare,
  Image as ImageIcon,
  Pencil,
  BarChart3,
  History,
  RotateCcw,
  Loader2,
  CalendarDays,
  Zap,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { ChoreForm } from "@/components/chores/chore-form";
import { useChores } from "@/lib/hooks/use-chores";
import { useAssignments } from "@/lib/hooks/use-assignments";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { getCategoryColor } from "@/lib/constants/categories";
import type { Chore, ChoreCategory } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Difficulty helpers
// ---------------------------------------------------------------------------

const DIFFICULTY_LABELS: Record<number, string> = {
  1: "Easy",
  2: "Simple",
  3: "Medium",
  4: "Hard",
  5: "Expert",
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ChoreDetailPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const choreId = params.id as string;
  const startInEditMode = searchParams.get("edit") === "true";

  const { chores, updateChore } = useChores();
  const { assignments } = useAssignments();
  const { members } = useMembers();
  const { permissions, ui, memberId } = useHouseholdMode();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);

  const [isEditing, setIsEditing] = useState(startInEditMode);

  // -----------------------------------------------------------------------
  // Fetch chore directly (in case not in the chores list yet)
  // -----------------------------------------------------------------------

  const supabase = createClient();
  const { data: choreData, isLoading } = useQuery({
    queryKey: ["chore-detail", choreId],
    queryFn: async () => {
      const { data } = await supabase
        .from("chores")
        .select("*, chore_categories(*)")
        .eq("id", choreId)
        .single();
      return data as (Chore & { chore_categories?: ChoreCategory | null }) | null;
    },
    enabled: !!choreId,
  });

  // -----------------------------------------------------------------------
  // Completion history for this chore
  // -----------------------------------------------------------------------

  const { data: completions = [], isLoading: completionsLoading } = useQuery({
    queryKey: ["chore-completions", choreId],
    queryFn: async () => {
      const { data } = await supabase
        .from("completions")
        .select("*, assignments!inner(chore_id), members:completed_by(*)")
        .eq("assignments.chore_id", choreId)
        .order("completed_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
    enabled: !!choreId,
  });

  // -----------------------------------------------------------------------
  // Rotation info
  // -----------------------------------------------------------------------

  const { data: rotation } = useQuery({
    queryKey: ["chore-rotation", choreId],
    queryFn: async () => {
      const { data } = await supabase
        .from("rotation_groups")
        .select("id, household_id, chore_id, member_order, current_index, rotation_type, frequency, start_date, is_active, created_at")
        .eq("chore_id", choreId)
        .eq("is_active", true)
        .maybeSingle();
      return data;
    },
    enabled: !!choreId,
  });

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------

  const chore = choreData;

  const checklist = useMemo(() => {
    if (!chore?.checklist) return [];
    if (Array.isArray(chore.checklist)) return chore.checklist;
    try {
      return JSON.parse(chore.checklist as unknown as string);
    } catch {
      return [];
    }
  }, [chore?.checklist]);

  const choreAssignments = useMemo(
    () => assignments.filter((a: any) => a.chore_id === choreId),
    [assignments, choreId]
  );

  const totalCompleted = completions.length;
  const avgTime = useMemo(() => {
    const withTime = completions.filter((c: any) => c.actual_minutes && c.actual_minutes > 0);
    if (withTime.length === 0) return null;
    const sum = withTime.reduce((acc: number, c: any) => acc + (c.actual_minutes ?? 0), 0);
    return Math.round(sum / withTime.length);
  }, [completions]);

  const categoryName = chore?.chore_categories?.name ?? "General";
  const categoryColor = getCategoryColor(categoryName);

  // -----------------------------------------------------------------------
  // Edit handler
  // -----------------------------------------------------------------------

  const handleUpdate = useCallback(
    async (values: any) => {
      await updateChore.mutateAsync({
        id: choreId,
        name: values.name,
        description: values.description || null,
        difficulty: values.difficulty,
        estimated_minutes: values.estimated_minutes,
        icon: values.icon,
        category_id: values.category || null,
        checklist: JSON.stringify(
          values.checklist.map((item: any) => ({
            id: item.id,
            label: item.label,
            required: item.required,
          }))
        ),
        ai_verification_enabled: values.ai_verification_enabled,
        requires_approval: values.requires_approval,
      });
      setIsEditing(false);
    },
    [choreId, updateChore]
  );

  // -----------------------------------------------------------------------
  // Loading
  // -----------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 rounded-xl" />
        <Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }

  if (!chore) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-12 text-center">
        <p className="text-lg font-medium">Chore not found</p>
        <Button variant="outline" onClick={() => router.push("/chores")}>
          Back to Chores
        </Button>
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Edit mode
  // -----------------------------------------------------------------------

  if (isEditing) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24 sm:p-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => setIsEditing(false)}>
            <ArrowLeft className="size-4" />
          </Button>
          <h1 className="text-2xl font-bold tracking-tight">Edit Chore</h1>
        </div>
        <ChoreForm
          chore={chore}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditing(false)}
          isSubmitting={updateChore.isPending}
        />
      </div>
    );
  }

  // -----------------------------------------------------------------------
  // Detail view
  // -----------------------------------------------------------------------

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-4" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">{chore.name}</h1>
          <Badge
            variant="secondary"
            className="mt-1 text-xs"
            style={{
              backgroundColor: `${categoryColor}20`,
              color: categoryColor,
            }}
          >
            {categoryName}
          </Badge>
        </div>
        {permissions.canEditChores && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setIsEditing(true)}
          >
            <Pencil className="size-3.5" />
            Edit
          </Button>
        )}
      </div>

      {/* Chore Info Card */}
      <Card>
        <CardContent className="space-y-4">
          {/* Description */}
          {chore.description && (
            <p className="text-sm text-muted-foreground">{chore.description}</p>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {/* Difficulty */}
            <div className="flex items-center gap-1.5">
              {ui.difficultyDisplay === "stars" ? (
                <div className="flex items-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star
                      key={i}
                      className={cn(
                        "size-4",
                        i < chore.difficulty
                          ? "fill-amber-400 text-amber-400"
                          : "fill-muted text-muted"
                      )}
                    />
                  ))}
                </div>
              ) : (
                <span className="text-muted-foreground">
                  {DIFFICULTY_LABELS[chore.difficulty] ?? "Medium"}
                </span>
              )}
            </div>

            {/* Estimated time */}
            <div className="flex items-center gap-1 text-muted-foreground">
              <Clock className="size-4" />
              <span>{chore.estimated_minutes} min</span>
            </div>

            {/* Checklist count */}
            {checklist.length > 0 && (
              <div className="flex items-center gap-1 text-muted-foreground">
                <CheckSquare className="size-4" />
                <span>{checklist.length} steps</span>
              </div>
            )}
          </div>

          {/* Checklist */}
          {checklist.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-sm font-medium">Checklist</p>
                <div className="space-y-1.5">
                  {checklist.map((item: any, i: number) => (
                    <div
                      key={item.id ?? i}
                      className="flex items-start gap-2 text-sm text-muted-foreground"
                    >
                      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px]">
                        {i + 1}
                      </span>
                      <span>{item.label ?? item.step ?? item}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Reference Photo */}
      {chore.reference_photo_url && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ImageIcon className="size-4" />
              Reference Photo
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

      {/* Stats */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <BarChart3 className="size-4" />
            Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <div className="text-center">
              <p className="text-2xl font-bold">{totalCompleted}</p>
              <p className="text-xs text-muted-foreground">Times Completed</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">
                {avgTime !== null ? `${avgTime}m` : "--"}
              </p>
              <p className="text-xs text-muted-foreground">Avg Time</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{choreAssignments.length}</p>
              <p className="text-xs text-muted-foreground">Active Assignments</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Rotation Info */}
      {rotation && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <RotateCcw className="size-4" />
              Rotation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 text-sm">
              <Badge variant="outline">{rotation.rotation_type}</Badge>
              <Badge variant="secondary">{rotation.frequency}</Badge>
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Users className="size-4" />
              <span>
                {rotation.member_order.length} member
                {rotation.member_order.length !== 1 ? "s" : ""} in rotation
              </span>
            </div>
            <div className="flex -space-x-2">
              {rotation.member_order.map((mid: string) => {
                const m = members.find((mem) => mem.id === mid);
                return (
                  <div
                    key={mid}
                    className="flex size-8 items-center justify-center rounded-full border-2 border-background bg-muted text-xs font-medium"
                    title={m?.display_name ?? "Unknown"}
                  >
                    {m?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Completion History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="size-4" />
            Completion History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {completionsLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12" />
              ))}
            </div>
          ) : completions.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              No completions yet.
            </p>
          ) : (
            <div className="space-y-0 divide-y">
              {completions.map((completion: any) => {
                const member = completion.members;
                return (
                  <div
                    key={completion.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {member?.display_name?.charAt(0)?.toUpperCase() ?? "?"}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {member?.display_name ?? "Unknown"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {format(parseISO(completion.completed_at), "MMM d, h:mm a")}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-xs shrink-0">
                      {completion.actual_minutes && (
                        <span className="flex items-center gap-0.5 text-muted-foreground">
                          <Clock className="size-3" />
                          {completion.actual_minutes}m
                        </span>
                      )}
                      {completion.speed_bonus > 0 && (
                        <span className="flex items-center gap-0.5 text-blue-500">
                          <Zap className="size-3" />
                          +{completion.speed_bonus}
                        </span>
                      )}
                      <Badge variant="secondary" className="text-[10px]">
                        +{completion.points_earned} pts
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
