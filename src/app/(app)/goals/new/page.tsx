"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  ArrowLeft,
  Target,
  Lightbulb,
  Gamepad2,
  BookOpen,
  Music,
  Bike,
  Gift,
  Palette,
  Clapperboard,
} from "lucide-react";

import { cn } from "@/lib/utils/cn";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

const GOAL_ICONS = [
  { value: "target", label: "Target", icon: Target },
  { value: "gamepad-2", label: "Gaming", icon: Gamepad2 },
  { value: "book-open", label: "Books", icon: BookOpen },
  { value: "music", label: "Music", icon: Music },
  { value: "bike", label: "Sports", icon: Bike },
  { value: "gift", label: "Gift", icon: Gift },
  { value: "palette", label: "Art", icon: Palette },
  { value: "clapperboard", label: "Movies", icon: Clapperboard },
];

const GOAL_SUGGESTIONS = [
  { title: "New Video Game", icon: "gamepad-2", targetPoints: 500, monetaryValue: 6999 },
  { title: "Movie Night Out", icon: "clapperboard", targetPoints: 200, monetaryValue: 2500 },
  { title: "New Book", icon: "book-open", targetPoints: 150, monetaryValue: 1599 },
  { title: "Art Supplies", icon: "palette", targetPoints: 300, monetaryValue: 3999 },
  { title: "Extra Screen Time (1 hr)", icon: "gamepad-2", targetPoints: 100, monetaryValue: 0 },
  { title: "Sleepover with Friends", icon: "gift", targetPoints: 250, monetaryValue: 0 },
];

const AUTO_CONTRIBUTE_OPTIONS = [10, 25, 50, 75, 100];

const goalSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
  icon: z.string(),
  target_points: z.number().min(1, "Must be at least 1 point"),
  monetary_value: z.number().min(0).optional(),
  member_id: z.string().min(1, "Please select a member"),
  auto_contribute_enabled: z.boolean(),
  auto_contribute_percentage: z.number().min(0).max(100),
});

type GoalFormData = z.infer<typeof goalSchema>;

export default function NewGoalPage() {
  const router = useRouter();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);
  const { permissions, isAdmin } = useHouseholdMode();
  const { members, currentMember } = useMembers();
  const supabase = createClient();
  const queryClient = useQueryClient();

  const [selectedIcon, setSelectedIcon] = useState("target");
  const [autoContribute, setAutoContribute] = useState(false);
  const [autoContributePercent, setAutoContributePercent] = useState(10);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<GoalFormData>({
    resolver: zodResolver(goalSchema),
    defaultValues: {
      title: "",
      description: "",
      icon: "target",
      target_points: 100,
      monetary_value: 0,
      member_id: currentMember?.id || "",
      auto_contribute_enabled: false,
      auto_contribute_percentage: 10,
    },
  });

  const watchedMemberId = watch("member_id");

  // Update member_id when currentMember loads (especially for kids who can't change it)
  useEffect(() => {
    if (currentMember?.id && !watchedMemberId) {
      setValue("member_id", currentMember.id);
    }
  }, [currentMember?.id, watchedMemberId, setValue]);

  const createGoal = useMutation({
    mutationFn: async (data: GoalFormData) => {
      if (!householdId || !currentMember) throw new Error("Missing context");

      // Kids' goals require parent approval; parent-created goals are auto-approved
      const isKidCreating = currentMember.role === "kid";
      const goalStatus = isKidCreating ? "pending_approval" : "active";

      const { error } = await supabase.from("goals").insert({
        household_id: householdId,
        member_id: data.member_id,
        title: data.title,
        description: data.description || null,
        icon: selectedIcon,
        target_points: data.target_points,
        monetary_value: data.monetary_value ? data.monetary_value : null,
        auto_contribute_enabled: autoContribute,
        auto_contribute_percentage: autoContribute ? autoContributePercent : 0,
        status: goalStatus,
        created_by: currentMember.id,
      });
      if (error) throw error;
    },
    onSuccess: async () => {
      const isKid = currentMember?.role === "kid";
      toast.success(
        isKid
          ? "Goal submitted for parent approval!"
          : "Goal created!"
      );
      await queryClient.invalidateQueries({ queryKey: ["goals"] });
      router.push("/goals");
    },
    onError: (err) => {
      toast.error("Failed to create goal: " + err.message);
    },
  });

  const onSubmit = (data: GoalFormData) => {
    createGoal.mutate(data);
  };

  const applySuggestion = (suggestion: (typeof GOAL_SUGGESTIONS)[0]) => {
    setValue("title", suggestion.title);
    setValue("target_points", suggestion.targetPoints);
    setValue("monetary_value", suggestion.monetaryValue);
    setSelectedIcon(suggestion.icon);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <Target className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold">New Goal</h1>
      </div>

      {/* Goal Suggestions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Lightbulb className="h-4 w-4 text-amber-400" />
            Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {GOAL_SUGGESTIONS.map((suggestion, idx) => (
              <Button
                key={idx}
                variant="outline"
                className="h-auto py-2 px-3 text-left justify-start"
                onClick={() => applySuggestion(suggestion)}
              >
                <div>
                  <p className="text-xs font-medium">{suggestion.title}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {suggestion.targetPoints} pts
                    {suggestion.monetaryValue > 0 &&
                      ` / $${(suggestion.monetaryValue / 100).toFixed(2)}`}
                  </p>
                </div>
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Form */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        <Card>
          <CardContent className="space-y-4">
            {/* Title */}
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="e.g., New Video Game"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title.message}</p>
              )}
            </div>

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description">Description (optional)</Label>
              <Textarea
                id="description"
                placeholder="What are you saving for?"
                rows={2}
                {...register("description")}
              />
            </div>

            {/* Icon picker */}
            <div className="space-y-2">
              <Label>Icon</Label>
              <div className="flex flex-wrap gap-2">
                {GOAL_ICONS.map((iconOption) => {
                  const IconComp = iconOption.icon;
                  return (
                    <button
                      key={iconOption.value}
                      type="button"
                      onClick={() => setSelectedIcon(iconOption.value)}
                      className={cn(
                        "flex items-center justify-center h-10 w-10 rounded-lg border transition-all",
                        selectedIcon === iconOption.value
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-border text-muted-foreground hover:border-primary/50"
                      )}
                      title={iconOption.label}
                    >
                      <IconComp className="h-5 w-5" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Target points */}
            <div className="space-y-2">
              <Label htmlFor="target_points">Target Points</Label>
              <Input
                id="target_points"
                type="number"
                min={1}
                placeholder="100"
                {...register("target_points", { valueAsNumber: true })}
              />
              {errors.target_points && (
                <p className="text-xs text-destructive">
                  {errors.target_points.message}
                </p>
              )}
            </div>

            {/* Monetary value */}
            <div className="space-y-2">
              <Label htmlFor="monetary_value">
                Monetary Value (cents, optional)
              </Label>
              <Input
                id="monetary_value"
                type="number"
                min={0}
                placeholder="e.g., 6999 for $69.99"
                {...register("monetary_value", { valueAsNumber: true })}
              />
              <p className="text-xs text-muted-foreground">
                The real-world dollar value of this goal, in cents.
              </p>
            </div>

            {/* Assigned member — kids can only assign to themselves */}
            <div className="space-y-2">
              <Label>Assigned To</Label>
              {isAdmin ? (
                <Select
                  value={watchedMemberId}
                  onValueChange={(v) => setValue("member_id", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select member" />
                  </SelectTrigger>
                  <SelectContent>
                    {members.map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.display_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={currentMember?.display_name ?? "You"}
                  disabled
                  className="opacity-70"
                />
              )}
              {errors.member_id && (
                <p className="text-xs text-destructive">
                  {errors.member_id.message}
                </p>
              )}
            </div>

            <Separator />

            {/* Auto-contribute toggle */}
            <div className="flex items-center justify-between">
              <div>
                <Label>Auto-Contribute</Label>
                <p className="text-xs text-muted-foreground">
                  Automatically contribute a percentage of earned points to this
                  goal.
                </p>
              </div>
              <Switch
                checked={autoContribute}
                onCheckedChange={setAutoContribute}
              />
            </div>

            {/* Auto-contribute percentage */}
            {autoContribute && (
              <div className="space-y-2">
                <Label>Contribution Percentage</Label>
                <div className="flex gap-2">
                  {AUTO_CONTRIBUTE_OPTIONS.map((pct) => (
                    <Button
                      key={pct}
                      type="button"
                      size="sm"
                      variant={autoContributePercent === pct ? "default" : "outline"}
                      onClick={() => setAutoContributePercent(pct)}
                    >
                      {pct}%
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => router.back()}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={createGoal.isPending}
            className="flex-1"
          >
            {createGoal.isPending ? "Creating..." : "Create Goal"}
          </Button>
        </div>
      </form>
    </div>
  );
}
