"use client";

import { useState, useMemo, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  format,
  isToday,
  isSameDay,
} from "date-fns";
import {
  Calendar as CalendarIcon,
  Filter,
  LayoutGrid,
  List,
  Plus,
  CalendarClock,
  Check,
  SkipForward,
  RotateCcw,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { WeekView } from "@/components/schedule/week-view";
import { CalendarView } from "@/components/schedule/calendar-view";
import { CreateScheduleDialog } from "@/components/schedule/create-schedule-dialog";
import { SchedulesList } from "@/components/schedule/schedules-list";
import type { ScheduleAssignment } from "@/components/schedule/day-column";
import type { Member, Assignment, Chore, ChoreCategory } from "@/lib/supabase/types";

/** Raw assignment row returned by the schedule query with joined chore + category + member data */
type RawScheduleAssignment = Assignment & {
  chores: (Chore & { chore_categories: ChoreCategory | null }) | null;
  members: Member | null;
};

/** Schedule assignment extended with display fields */
type ExtendedScheduleAssignment = ScheduleAssignment & {
  dueDate: string;
  rotationGroupId: string | null;
  assignedTo: string | null;
  chorePoints: number;
};

export default function SchedulePage() {
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { members, isLoading: membersLoading } = useMembers();
  const { permissions } = useHouseholdMode();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState("calendar");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState<"week" | "month">("week");
  const [filterMember, setFilterMember] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date());
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Compute date range for fetching
  const dateRange = useMemo(() => {
    if (viewMode === "week") {
      return {
        start: format(
          startOfWeek(currentDate, { weekStartsOn: 1 }),
          "yyyy-MM-dd"
        ),
        end: format(
          endOfWeek(currentDate, { weekStartsOn: 1 }),
          "yyyy-MM-dd"
        ),
      };
    }
    const monthStart = startOfMonth(currentDate);
    const monthEnd = endOfMonth(currentDate);
    return {
      start: format(
        startOfWeek(monthStart, { weekStartsOn: 1 }),
        "yyyy-MM-dd"
      ),
      end: format(endOfWeek(monthEnd, { weekStartsOn: 1 }), "yyyy-MM-dd"),
    };
  }, [currentDate, viewMode]);

  // Fetch assignments with joined chore and member data
  const { data: rawAssignments = [], isLoading: assignmentsLoading } =
    useQuery({
      queryKey: ["schedule-assignments", householdId, dateRange],
      queryFn: async () => {
        if (!householdId) return [];
        const { data } = await supabase
          .from("assignments")
          .select("*, chores(*, chore_categories(*)), members!assigned_to(*)")
          .eq("household_id", householdId)
          .gte("due_date", dateRange.start)
          .lte("due_date", dateRange.end)
          .order("due_date", { ascending: true })
          .order("due_time", { ascending: true });
        return data || [];
      },
      enabled: !!householdId,
    });

  // Quick-action mutation: mark Done or Skip
  const updateAssignment = useMutation({
    mutationFn: async ({
      id,
      status,
      assignedTo,
      chorePoints,
    }: {
      id: string;
      status: "completed" | "skipped";
      assignedTo?: string;
      chorePoints?: number;
    }) => {
      if (status === "completed" && assignedTo) {
        // Create a proper completion record so points are awarded
        const { error: compError } = await supabase.from("completions").insert({
          assignment_id: id,
          completed_by: assignedTo,
          needs_approval: false,
          points_earned: chorePoints ?? 0,
          speed_bonus: 0,
          status: "approved",
        });
        if (compError) throw compError;
      }

      const { error } = await supabase
        .from("assignments")
        .update({ status })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["schedule-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["assignments"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      toast.success(
        variables.status === "completed"
          ? "Marked as done!"
          : "Assignment skipped"
      );
    },
    onError: (error) => {
      toast.error("Failed to update: " + error.message);
    },
  });

  // Build member lookup
  const memberMap = useMemo(() => {
    const map: Record<string, Member> = {};
    for (const m of members) map[m.id] = m;
    return map;
  }, [members]);

  // Transform raw assignments to ScheduleAssignment format + apply filters
  const scheduleAssignments = useMemo(() => {
    return rawAssignments
      .filter((a: RawScheduleAssignment) => {
        if (filterMember !== "all" && a.assigned_to !== filterMember)
          return false;
        if (filterStatus !== "all" && a.status !== filterStatus) return false;
        if (filterCategory !== "all") {
          const catName = a.chores?.chore_categories?.name || "";
          if (catName !== filterCategory) return false;
        }
        return true;
      })
      .map(
        (
          a: RawScheduleAssignment
        ): ExtendedScheduleAssignment => {
          const member = memberMap[a.assigned_to];
          return {
            id: a.id,
            choreName: a.chores?.name || "Unknown Chore",
            choreIcon: a.chores?.icon || "clipboard",
            memberName: member?.display_name || "Unassigned",
            memberColor: member?.favorite_color || "#6b7280",
            dueTime: a.due_time || null,
            status: a.status,
            categoryName: a.chores?.chore_categories?.name || "General",
            dueDate: a.due_date,
            rotationGroupId: a.rotation_group_id || null,
            assignedTo: a.assigned_to || null,
            chorePoints: a.chores?.difficulty ? a.chores.difficulty * 10 : 10,
          };
        }
      );
  }, [rawAssignments, memberMap, filterMember, filterCategory, filterStatus]);

  // Group assignments by date
  const assignmentDates = useMemo(() => {
    const grouped: Record<string, ScheduleAssignment[]> = {};
    for (const a of scheduleAssignments) {
      const key = a.dueDate;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(a);
    }
    return grouped;
  }, [scheduleAssignments]);

  // Assignments for the selected day (for detail panel)
  const selectedDayAssignments = useMemo(() => {
    if (!selectedDate) return [];
    const key = format(selectedDate, "yyyy-MM-dd");
    return assignmentDates[key] || [];
  }, [selectedDate, assignmentDates]);

  // Raw assignment lookup for extra details (difficulty, time est)
  const rawAssignmentMap = useMemo(() => {
    const map: Record<string, RawScheduleAssignment> = {};
    for (const a of rawAssignments as RawScheduleAssignment[]) {
      map[a.id] = a;
    }
    return map;
  }, [rawAssignments]);

  // Get unique categories from assignments
  const categories = useMemo(() => {
    const catSet = new Set<string>();
    for (const a of rawAssignments) {
      const catName = (a as RawScheduleAssignment).chores?.chore_categories?.name;
      if (catName) catSet.add(catName);
    }
    return Array.from(catSet).sort();
  }, [rawAssignments]);

  const handleDayClick = useCallback((date: Date) => {
    setSelectedDate(date);
  }, []);

  const isLoading = membersLoading || assignmentsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6 p-4 pb-24 md:p-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-9 w-64" />
        </div>
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 pb-24 md:p-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <CalendarIcon className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold">Schedule</h1>
        </div>

        {/* Create button */}
        {permissions.canAssignChores && (
          <Button
            size="sm"
            className="gap-1.5"
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            New Schedule
          </Button>
        )}
      </div>

      {/* Tabs: Calendar / Schedules */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="calendar" className="gap-1.5">
            <CalendarIcon className="size-3.5" />
            Calendar
          </TabsTrigger>
          <TabsTrigger value="schedules" className="gap-1.5">
            <CalendarClock className="size-3.5" />
            Schedules
          </TabsTrigger>
        </TabsList>

        {/* ============================================================= */}
        {/* Calendar Tab */}
        {/* ============================================================= */}
        <TabsContent value="calendar" className="mt-4 space-y-4">
          {/* View toggle + task count */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Badge variant="secondary">
              {scheduleAssignments.length} task
              {scheduleAssignments.length !== 1 ? "s" : ""}
            </Badge>
            <div className="flex items-center gap-2">
              <Button
                variant={viewMode === "week" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("week")}
              >
                <List className="h-4 w-4 mr-1" />
                Week
              </Button>
              <Button
                variant={viewMode === "month" ? "default" : "outline"}
                size="sm"
                onClick={() => setViewMode("month")}
              >
                <LayoutGrid className="h-4 w-4 mr-1" />
                Month
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">Filter:</span>
            </div>

            <Select value={filterMember} onValueChange={setFilterMember}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Member" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Members</SelectItem>
                {members.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterCategory} onValueChange={setFilterCategory}>
              <SelectTrigger className="w-[140px]" size="sm">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                {categories.map((cat) => (
                  <SelectItem key={cat} value={cat}>
                    {cat}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={filterStatus} onValueChange={setFilterStatus}>
              <SelectTrigger className="w-[130px]" size="sm">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="in_progress">In Progress</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="skipped">Skipped</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Calendar content */}
          <Card>
            <CardContent>
              {viewMode === "week" ? (
                <WeekView
                  currentDate={currentDate}
                  onDateChange={setCurrentDate}
                  assignments={scheduleAssignments}
                  assignmentDates={assignmentDates}
                  onDayClick={handleDayClick}
                  selectedDate={selectedDate}
                />
              ) : (
                <CalendarView
                  currentDate={currentDate}
                  onDateChange={setCurrentDate}
                  assignmentDates={assignmentDates}
                  onDayClick={handleDayClick}
                  selectedDate={selectedDate}
                />
              )}
            </CardContent>
          </Card>

          {/* ========================================================= */}
          {/* Day Detail Panel — shown below the calendar */}
          {/* ========================================================= */}
          {selectedDate && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <CalendarIcon className="size-4 text-primary" />
                  {isToday(selectedDate)
                    ? "Today"
                    : format(selectedDate, "EEEE, MMMM d")}
                  {selectedDayAssignments.length > 0 && (
                    <Badge variant="secondary" className="ml-auto text-xs">
                      {selectedDayAssignments.length} task
                      {selectedDayAssignments.length !== 1 ? "s" : ""}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {selectedDayAssignments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">
                    No tasks scheduled for this day
                  </p>
                ) : (
                  selectedDayAssignments.map((assignment) => {
                    const raw = rawAssignmentMap[assignment.id];
                    const difficulty = raw?.chores?.difficulty || 1;
                    const estMinutes = raw?.chores?.estimated_minutes || 0;
                    const categoryColor =
                      raw?.chores?.chore_categories?.color || null;
                    const isPending =
                      assignment.status === "pending" ||
                      assignment.status === "in_progress";

                    return (
                      <div
                        key={assignment.id}
                        className={cn(
                          "rounded-lg border p-3 transition-all",
                          assignment.status === "completed" &&
                            "border-emerald-500/30 bg-emerald-500/5",
                          assignment.status === "overdue" &&
                            "border-red-500/30 bg-red-500/5",
                          assignment.status === "in_progress" &&
                            "border-blue-500/30 bg-blue-500/5",
                          assignment.status === "skipped" &&
                            "border-muted-foreground/30 bg-muted/30 opacity-60",
                          assignment.status === "pending" &&
                            "border-border/50 bg-card"
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          {/* Left: assignment info */}
                          <div className="flex-1 min-w-0 space-y-1.5">
                            {/* Member + category row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="flex items-center gap-1.5">
                                <div
                                  className="h-3 w-3 rounded-full shrink-0"
                                  style={{
                                    backgroundColor: assignment.memberColor,
                                  }}
                                />
                                <span className="text-xs font-medium">
                                  {assignment.memberName}
                                </span>
                              </div>
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0"
                                style={
                                  categoryColor
                                    ? {
                                        borderColor: categoryColor + "60",
                                        color: categoryColor,
                                      }
                                    : undefined
                                }
                              >
                                {assignment.categoryName}
                              </Badge>
                              {assignment.rotationGroupId && (
                                <RotateCcw className="size-3 text-muted-foreground/60" />
                              )}
                            </div>

                            {/* Chore name */}
                            <p className="text-sm font-semibold leading-tight">
                              {assignment.choreName}
                            </p>

                            {/* Meta: difficulty, time, due time, status */}
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-[10px] text-amber-500">
                                {Array.from({ length: difficulty })
                                  .map(() => "★")
                                  .join("")}
                              </span>
                              {estMinutes > 0 && (
                                <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                                  <Clock className="size-2.5" />
                                  {estMinutes}m
                                </span>
                              )}
                              {assignment.dueTime && (
                                <span className="text-[10px] text-muted-foreground">
                                  {assignment.dueTime}
                                </span>
                              )}
                              {assignment.status !== "pending" && (
                                <Badge
                                  variant={
                                    assignment.status === "completed"
                                      ? "default"
                                      : assignment.status === "overdue"
                                      ? "destructive"
                                      : "secondary"
                                  }
                                  className="text-[9px] px-1.5 py-0"
                                >
                                  {assignment.status === "completed"
                                    ? "Done"
                                    : assignment.status === "overdue"
                                    ? "Overdue"
                                    : assignment.status === "in_progress"
                                    ? "Active"
                                    : assignment.status === "skipped"
                                    ? "Skipped"
                                    : assignment.status}
                                </Badge>
                              )}
                            </div>
                          </div>

                          {/* Right: quick actions */}
                          {isPending && (
                            <div className="flex flex-col gap-1 shrink-0">
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                                onClick={() =>
                                  updateAssignment.mutate({
                                    id: assignment.id,
                                    status: "completed",
                                    assignedTo: (assignment as ExtendedScheduleAssignment).assignedTo ?? undefined,
                                    chorePoints: (assignment as ExtendedScheduleAssignment).chorePoints ?? undefined,
                                  })
                                }
                                disabled={updateAssignment.isPending}
                              >
                                <Check className="size-3" />
                                Done
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs gap-1 text-muted-foreground"
                                onClick={() =>
                                  updateAssignment.mutate({
                                    id: assignment.id,
                                    status: "skipped",
                                  })
                                }
                                disabled={updateAssignment.isPending}
                              >
                                <SkipForward className="size-3" />
                                Skip
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ============================================================= */}
        {/* Schedules Tab */}
        {/* ============================================================= */}
        <TabsContent value="schedules" className="mt-4">
          <SchedulesList onCreateNew={() => setCreateDialogOpen(true)} />
        </TabsContent>
      </Tabs>

      {/* Create Schedule Dialog */}
      <CreateScheduleDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
      />
    </div>
  );
}
