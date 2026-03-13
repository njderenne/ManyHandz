"use client";

import { useState, useMemo, useCallback } from "react";
import { format } from "date-fns";
import {
  Search,
  CalendarCheck,
  Repeat,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Clock,
  Star,
  Check,
  Loader2,
  RotateCcw,
  Pin,
  Calendar,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";

import { useChores } from "@/lib/hooks/use-chores";
import { useMembers } from "@/lib/hooks/use-members";
import { useRotationGroups } from "@/lib/hooks/use-rotation-groups";
import { getCategoryColor } from "@/lib/constants/categories";
import { getFrequencyLabel } from "@/lib/utils/rotation";

import type { Chore, ChoreCategory } from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Chore with joined category from useChores() */
type ChoreWithCategory = Chore & { chore_categories: ChoreCategory | null };

type ScheduleType = "one-off" | "recurring";
type Frequency = "daily" | "weekly" | "biweekly" | "monthly";
type RotationType = "round_robin" | "fixed";

interface CreateScheduleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateScheduleDialog({
  open,
  onOpenChange,
}: CreateScheduleDialogProps) {
  const { chores } = useChores();
  const { members } = useMembers();
  const { createRotation } = useRotationGroups();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const supabase = createClient();
  const queryClient = useQueryClient();

  // -----------------------------------------------------------------------
  // Step state
  // -----------------------------------------------------------------------
  const [step, setStep] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");

  // Step 1: Chore selection
  const [selectedChoreId, setSelectedChoreId] = useState<string>("");

  // Step 2: Type selection
  const [scheduleType, setScheduleType] = useState<ScheduleType | null>(null);

  // Step 3 (one-off): Assignment config
  const [assignMemberId, setAssignMemberId] = useState<string>("");
  const [dueDate, setDueDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [dueTime, setDueTime] = useState("");

  // Step 3 (recurring): Schedule config
  const [frequency, setFrequency] = useState<Frequency>("weekly");
  const [rotationType, setRotationType] = useState<RotationType>("round_robin");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [startDate, setStartDate] = useState(format(new Date(), "yyyy-MM-dd"));

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------
  const createAssignment = useMutation({
    mutationFn: async () => {
      if (!householdId || !selectedChoreId || !assignMemberId || !dueDate) {
        throw new Error("Please fill in all required fields");
      }
      const { error } = await supabase.from("assignments").insert({
        chore_id: selectedChoreId,
        household_id: householdId,
        assigned_to: assignMemberId,
        due_date: dueDate,
        due_time: dueTime || null,
        status: "pending",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      toast.success("Chore assigned!");
      handleClose();
    },
    onError: (err) => {
      toast.error("Failed to assign: " + (err as Error).message);
    },
  });

  // -----------------------------------------------------------------------
  // Derived data
  // -----------------------------------------------------------------------
  const selectedChore = useMemo(
    () => (chores as ChoreWithCategory[]).find((c) => c.id === selectedChoreId),
    [chores, selectedChoreId]
  );

  // Group chores by category for step 1
  const choresByCategory = useMemo(() => {
    const groups: Record<string, ChoreWithCategory[]> = {};
    for (const chore of chores as ChoreWithCategory[]) {
      const catName = chore.chore_categories?.name ?? "General";
      if (!groups[catName]) groups[catName] = [];
      groups[catName].push(chore);
    }
    // Sort categories alphabetically
    return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b));
  }, [chores]);

  // Filter by search
  const filteredChoresByCategory = useMemo(() => {
    if (!searchQuery.trim()) return choresByCategory;
    const q = searchQuery.toLowerCase();
    return choresByCategory
      .map(([cat, chores]) => [
        cat,
        chores.filter((c: any) => c.name.toLowerCase().includes(q)),
      ] as [string, any[]])
      .filter(([, chores]) => chores.length > 0);
  }, [choresByCategory, searchQuery]);

  // -----------------------------------------------------------------------
  // Handlers
  // -----------------------------------------------------------------------
  function handleClose() {
    onOpenChange(false);
    // Reset state after animation completes
    setTimeout(() => {
      setStep(1);
      setSearchQuery("");
      setSelectedChoreId("");
      setScheduleType(null);
      setAssignMemberId("");
      setDueDate(format(new Date(), "yyyy-MM-dd"));
      setDueTime("");
      setFrequency("weekly");
      setRotationType("round_robin");
      setSelectedMembers([]);
      setStartDate(format(new Date(), "yyyy-MM-dd"));
    }, 200);
  }

  function handleChoreSelect(choreId: string) {
    setSelectedChoreId(choreId);
    setStep(2);
  }

  function handleTypeSelect(type: ScheduleType) {
    setScheduleType(type);
    setStep(3);
  }

  function toggleMember(memberId: string) {
    setSelectedMembers((prev) =>
      prev.includes(memberId)
        ? prev.filter((id) => id !== memberId)
        : [...prev, memberId]
    );
  }

  function moveMember(index: number, direction: "up" | "down") {
    setSelectedMembers((prev) => {
      const arr = [...prev];
      const newIndex = direction === "up" ? index - 1 : index + 1;
      if (newIndex < 0 || newIndex >= arr.length) return arr;
      [arr[index], arr[newIndex]] = [arr[newIndex], arr[index]];
      return arr;
    });
  }

  function handleSubmit() {
    if (scheduleType === "one-off") {
      createAssignment.mutate();
    } else {
      const memberOrder =
        rotationType === "fixed"
          ? selectedMembers.slice(0, 1)
          : selectedMembers;
      createRotation.mutate(
        {
          chore_id: selectedChoreId,
          member_order: memberOrder,
          rotation_type: rotationType,
          frequency,
          start_date: startDate,
        },
        { onSuccess: () => handleClose() }
      );
    }
  }

  const isSubmitting = createAssignment.isPending || createRotation.isPending;

  // Can submit?
  const canSubmit = useMemo(() => {
    if (scheduleType === "one-off") {
      return !!assignMemberId && !!dueDate;
    }
    if (scheduleType === "recurring") {
      return selectedMembers.length > 0 && !!startDate;
    }
    return false;
  }, [scheduleType, assignMemberId, dueDate, selectedMembers, startDate]);

  // -----------------------------------------------------------------------
  // Step titles
  // -----------------------------------------------------------------------
  const stepTitles: Record<number, { title: string; description: string }> = {
    1: {
      title: "Pick a Chore",
      description: "Select which chore you want to schedule",
    },
    2: {
      title: "Schedule Type",
      description: "Choose how you want to assign this chore",
    },
    3: {
      title:
        scheduleType === "one-off"
          ? "Assign to Member"
          : "Configure Schedule",
      description:
        scheduleType === "one-off"
          ? "Choose who does it and when"
          : "Set up the recurring rotation",
    },
  };

  const currentStep = stepTitles[step] ?? stepTitles[1];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            {step > 1 && (
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                onClick={() => setStep(step - 1)}
              >
                <ChevronLeft className="size-4" />
              </Button>
            )}
            <div>
              <DialogTitle>{currentStep.title}</DialogTitle>
              <DialogDescription>{currentStep.description}</DialogDescription>
            </div>
          </div>
          {/* Step indicator */}
          <div className="flex items-center gap-1.5 pt-2">
            {[1, 2, 3].map((s) => (
              <div
                key={s}
                className={cn(
                  "h-1 flex-1 rounded-full transition-colors",
                  s <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>
        </DialogHeader>

        {/* --------------------------------------------------------------- */}
        {/* Step 1: Pick a Chore */}
        {/* --------------------------------------------------------------- */}
        {step === 1 && (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                placeholder="Search chores..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Chore list grouped by category */}
            <div className="space-y-4">
              {filteredChoresByCategory.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  {(chores as ChoreWithCategory[]).length === 0
                    ? "No chores created yet. Add some from the Chores page first!"
                    : "No chores match your search."}
                </p>
              )}

              {filteredChoresByCategory.map(([category, catChores]) => (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: getCategoryColor(category),
                      }}
                    />
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                      {category}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      ({catChores.length})
                    </span>
                  </div>
                  <div className="space-y-1">
                    {catChores.map((chore: any) => (
                      <button
                        key={chore.id}
                        onClick={() => handleChoreSelect(chore.id)}
                        className={cn(
                          "w-full text-left rounded-lg border border-border/50 p-3 transition-all",
                          "hover:border-primary/50 hover:bg-primary/5",
                          selectedChoreId === chore.id &&
                            "border-primary bg-primary/10"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">
                            {chore.name}
                          </span>
                          <div className="flex items-center gap-2">
                            {/* Difficulty */}
                            <div className="flex items-center gap-0.5">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <Star
                                  key={i}
                                  className={cn(
                                    "size-2.5",
                                    i < chore.difficulty
                                      ? "fill-amber-400 text-amber-400"
                                      : "fill-muted text-muted"
                                  )}
                                />
                              ))}
                            </div>
                            {/* Time */}
                            <Badge
                              variant="secondary"
                              className="text-[10px] px-1.5"
                            >
                              <Clock className="size-2.5 mr-0.5" />
                              {chore.estimated_minutes}m
                            </Badge>
                            <ChevronRight className="size-4 text-muted-foreground" />
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Step 2: Choose Type */}
        {/* --------------------------------------------------------------- */}
        {step === 2 && (
          <div className="space-y-4">
            {/* Show selected chore */}
            {selectedChore && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <div
                  className="h-2 w-2 rounded-full shrink-0"
                  style={{
                    backgroundColor: getCategoryColor(
                      selectedChore.chore_categories?.name ?? "General"
                    ),
                  }}
                />
                <span className="text-sm font-medium truncate">
                  {selectedChore.name}
                </span>
              </div>
            )}

            <div className="grid gap-3">
              {/* One-off card */}
              <button
                onClick={() => handleTypeSelect("one-off")}
                className={cn(
                  "flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all",
                  "hover:border-primary/50 hover:bg-primary/5",
                  scheduleType === "one-off" && "border-primary bg-primary/10"
                )}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                  <CalendarCheck className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">One-Time Assignment</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Assign this chore to someone for a specific date
                  </p>
                </div>
              </button>

              {/* Recurring card */}
              <button
                onClick={() => handleTypeSelect("recurring")}
                className={cn(
                  "flex items-start gap-4 rounded-xl border-2 p-4 text-left transition-all",
                  "hover:border-primary/50 hover:bg-primary/5",
                  scheduleType === "recurring" &&
                    "border-primary bg-primary/10"
                )}
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
                  <Repeat className="size-5" />
                </div>
                <div>
                  <p className="font-semibold text-sm">Recurring Schedule</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Automatically rotate this chore on a regular basis
                  </p>
                </div>
              </button>
            </div>
          </div>
        )}

        {/* --------------------------------------------------------------- */}
        {/* Step 3: Configure */}
        {/* --------------------------------------------------------------- */}
        {step === 3 && scheduleType === "one-off" && (
          <div className="space-y-5">
            {/* Selected chore summary */}
            {selectedChore && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <CalendarCheck className="size-4 text-blue-500 shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedChore.name}
                </span>
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  One-Time
                </Badge>
              </div>
            )}

            {/* Member picker */}
            <div className="space-y-2">
              <Label>Assign to</Label>
              <div className="grid grid-cols-2 gap-2">
                {members.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => setAssignMemberId(m.id)}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg border-2 p-2.5 transition-all text-left",
                      assignMemberId === m.id
                        ? "border-primary bg-primary/10"
                        : "border-border/50 hover:border-primary/30"
                    )}
                  >
                    <div
                      className="flex size-8 items-center justify-center rounded-full text-xs font-bold text-white"
                      style={{ backgroundColor: m.favorite_color }}
                    >
                      {m.display_name.charAt(0).toUpperCase()}
                    </div>
                    <span className="text-sm font-medium truncate">
                      {m.display_name}
                    </span>
                    {assignMemberId === m.id && (
                      <Check className="size-4 text-primary ml-auto shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Date & time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Time (optional)</Label>
                <Input
                  type="time"
                  value={dueTime}
                  onChange={(e) => setDueTime(e.target.value)}
                />
              </div>
            </div>

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !canSubmit}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Assigning...
                  </>
                ) : (
                  "Assign Chore"
                )}
              </Button>
            </div>
          </div>
        )}

        {step === 3 && scheduleType === "recurring" && (
          <div className="flex-1 overflow-y-auto space-y-5 min-h-0">
            {/* Selected chore summary */}
            {selectedChore && (
              <div className="flex items-center gap-2 p-2.5 rounded-lg bg-muted/50">
                <Repeat className="size-4 text-purple-500 shrink-0" />
                <span className="text-sm font-medium truncate">
                  {selectedChore.name}
                </span>
                <Badge variant="secondary" className="text-[10px] ml-auto">
                  Recurring
                </Badge>
              </div>
            )}

            {/* Frequency selector */}
            <div className="space-y-2">
              <Label>How often?</Label>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    "daily",
                    "weekly",
                    "biweekly",
                    "monthly",
                  ] as Frequency[]
                ).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFrequency(f)}
                    className={cn(
                      "rounded-lg border-2 px-3 py-2 text-sm font-medium transition-all",
                      frequency === f
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border/50 hover:border-primary/30"
                    )}
                  >
                    {getFrequencyLabel(f)}
                  </button>
                ))}
              </div>
            </div>

            {/* Rotation type */}
            <div className="space-y-2">
              <Label>Assignment type</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={() => setRotationType("round_robin")}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border-2 p-3 text-left transition-all",
                    rotationType === "round_robin"
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-primary/30"
                  )}
                >
                  <RotateCcw className="size-4 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Round Robin</p>
                    <p className="text-[10px] text-muted-foreground">
                      Members take turns
                    </p>
                  </div>
                </button>
                <button
                  onClick={() => setRotationType("fixed")}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg border-2 p-3 text-left transition-all",
                    rotationType === "fixed"
                      ? "border-primary bg-primary/10"
                      : "border-border/50 hover:border-primary/30"
                  )}
                >
                  <Pin className="size-4 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Fixed</p>
                    <p className="text-[10px] text-muted-foreground">
                      Always same person
                    </p>
                  </div>
                </button>
              </div>
            </div>

            {/* Member selection */}
            <div className="space-y-2">
              <Label>
                {rotationType === "round_robin"
                  ? "Rotation order (select members, then reorder)"
                  : "Assign to"}
              </Label>

              {/* Available members to select */}
              <div className="space-y-1.5">
                {members.map((m) => {
                  const isSelected = selectedMembers.includes(m.id);
                  const orderIndex = selectedMembers.indexOf(m.id);
                  return (
                    <button
                      key={m.id}
                      onClick={() => {
                        if (rotationType === "fixed") {
                          // Single select
                          setSelectedMembers([m.id]);
                        } else {
                          toggleMember(m.id);
                        }
                      }}
                      className={cn(
                        "flex items-center gap-2.5 w-full rounded-lg border-2 p-2.5 transition-all text-left",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border/50 hover:border-primary/30"
                      )}
                    >
                      {/* Order number */}
                      {rotationType === "round_robin" && isSelected && (
                        <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground shrink-0">
                          {orderIndex + 1}
                        </span>
                      )}
                      <div
                        className="flex size-7 items-center justify-center rounded-full text-[10px] font-bold text-white shrink-0"
                        style={{ backgroundColor: m.favorite_color }}
                      >
                        {m.display_name.charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium flex-1 truncate">
                        {m.display_name}
                      </span>
                      {isSelected && (
                        <Check className="size-4 text-primary shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Reorder controls for round robin */}
              {rotationType === "round_robin" &&
                selectedMembers.length > 1 && (
                  <div className="mt-3 space-y-1.5 rounded-lg border border-border/50 p-2.5">
                    <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider mb-2">
                      Rotation Order
                    </p>
                    {selectedMembers.map((mid, i) => {
                      const m = members.find((mem) => mem.id === mid);
                      if (!m) return null;
                      return (
                        <div
                          key={mid}
                          className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5"
                        >
                          <span className="text-xs font-bold text-muted-foreground w-4">
                            {i + 1}.
                          </span>
                          <div
                            className="flex size-6 items-center justify-center rounded-full text-[9px] font-bold text-white shrink-0"
                            style={{ backgroundColor: m.favorite_color }}
                          >
                            {m.display_name.charAt(0).toUpperCase()}
                          </div>
                          <span className="text-xs font-medium flex-1 truncate">
                            {m.display_name}
                          </span>
                          <div className="flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={i === 0}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveMember(i, "up");
                              }}
                            >
                              <ChevronUp className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              disabled={i === selectedMembers.length - 1}
                              onClick={(e) => {
                                e.stopPropagation();
                                moveMember(i, "down");
                              }}
                            >
                              <ChevronDown className="size-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
            </div>

            {/* Start date */}
            <div className="space-y-2">
              <Label>Start date</Label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
              <p className="text-[10px] text-muted-foreground">
                The first assignment will be created on this date.
              </p>
            </div>

            {/* Summary preview */}
            {canSubmit && (
              <>
                <Separator />
                <div className="rounded-lg border border-border/50 bg-muted/30 p-3 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Summary
                  </p>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Chore</span>
                      <span className="font-medium">
                        {selectedChore?.name}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Frequency</span>
                      <span className="font-medium">
                        {getFrequencyLabel(frequency)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Type</span>
                      <span className="font-medium">
                        {rotationType === "round_robin"
                          ? "Round Robin"
                          : "Fixed"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Members</span>
                      <span className="font-medium">
                        {selectedMembers
                          .map(
                            (id) =>
                              members.find((m) => m.id === id)?.display_name
                          )
                          .filter(Boolean)
                          .join(" → ")}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Starts</span>
                      <span className="font-medium">
                        {format(new Date(startDate + "T00:00:00"), "MMM d, yyyy")}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Submit */}
            <div className="flex justify-end gap-2 pt-2 pb-1">
              <Button variant="outline" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={isSubmitting || !canSubmit}
              >
                {isSubmitting ? (
                  <>
                    <Loader2 className="size-4 animate-spin mr-2" />
                    Creating...
                  </>
                ) : (
                  "Create Schedule"
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
