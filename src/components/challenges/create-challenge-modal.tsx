"use client";

import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDays, addHours, format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useChallenges } from "@/lib/hooks/use-challenges";
import { useMembers } from "@/lib/hooks/use-members";
import { Zap, Target, ShieldCheck, Sparkles } from "lucide-react";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createChallengeSchema = z.object({
  title: z.string().min(1, "Title is required").max(100),
  description: z.string().max(500).optional(),
  challenge_type: z.enum(["double_points", "complete_count", "no_overdue", "custom"]),
  target_value: z.coerce.number().min(1).optional(),
  bonus_points: z.coerce.number().min(0).default(0),
  points_multiplier: z.coerce.number().min(1).max(10).default(1),
  duration_days: z.coerce.number().min(1).max(30).default(1),
});

type FormValues = z.infer<typeof createChallengeSchema>;

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface CreateChallengeModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function CreateChallengeModal({
  open,
  onOpenChange,
}: CreateChallengeModalProps) {
  const { createChallenge } = useChallenges();
  const { currentMember } = useMembers();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createChallengeSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      title: "",
      description: "",
      challenge_type: "double_points",
      bonus_points: 0,
      points_multiplier: 2,
      duration_days: 1,
    },
  });

  const challengeType = watch("challenge_type");

  const onSubmit = async (values: FormValues) => {
    if (!currentMember) return;

    const now = new Date();
    const endsAt = addDays(now, values.duration_days);

    await createChallenge.mutateAsync({
      title: values.title,
      description: values.description,
      challenge_type: values.challenge_type,
      target_value: values.target_value,
      bonus_points: values.bonus_points,
      points_multiplier: values.points_multiplier,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
      created_by: currentMember.id,
    });

    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quick Create Challenge</DialogTitle>
          <DialogDescription>
            Create a bonus challenge for your household.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Challenge Type */}
          <div className="space-y-2">
            <Label>Challenge Type</Label>
            <Select
              value={challengeType}
              onValueChange={(v) =>
                setValue("challenge_type", v as FormValues["challenge_type"])
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="double_points">
                  <span className="flex items-center gap-2">
                    <Zap className="size-4 text-amber-400" /> Double Points
                  </span>
                </SelectItem>
                <SelectItem value="complete_count">
                  <span className="flex items-center gap-2">
                    <Target className="size-4 text-blue-400" /> Completion Count
                  </span>
                </SelectItem>
                <SelectItem value="no_overdue">
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="size-4 text-emerald-400" /> No Overdue
                  </span>
                </SelectItem>
                <SelectItem value="custom">
                  <span className="flex items-center gap-2">
                    <Sparkles className="size-4 text-violet-400" /> Custom
                  </span>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Title */}
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder="Weekend Cleaning Sprint"
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
              placeholder="Complete as many chores as possible this weekend..."
              rows={2}
              {...register("description")}
            />
          </div>

          {/* Duration */}
          <div className="space-y-2">
            <Label>Duration</Label>
            <Select
              value={String(watch("duration_days"))}
              onValueChange={(v) => setValue("duration_days", Number(v))}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 day</SelectItem>
                <SelectItem value="2">2 days</SelectItem>
                <SelectItem value="3">3 days</SelectItem>
                <SelectItem value="5">5 days</SelectItem>
                <SelectItem value="7">1 week</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target Value (completion count only) */}
          {challengeType === "complete_count" && (
            <div className="space-y-2">
              <Label htmlFor="target_value">Target Completions</Label>
              <Input
                id="target_value"
                type="number"
                min={1}
                placeholder="10"
                {...register("target_value")}
              />
              {errors.target_value && (
                <p className="text-xs text-destructive">
                  {errors.target_value.message}
                </p>
              )}
            </div>
          )}

          {/* Multiplier (double points only) */}
          {challengeType === "double_points" && (
            <div className="space-y-2">
              <Label>Points Multiplier</Label>
              <Select
                value={String(watch("points_multiplier"))}
                onValueChange={(v) => setValue("points_multiplier", Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1.5">1.5x Points</SelectItem>
                  <SelectItem value="2">2x Points</SelectItem>
                  <SelectItem value="3">3x Points</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Bonus Points */}
          <div className="space-y-2">
            <Label htmlFor="bonus_points">Bonus Points</Label>
            <Input
              id="bonus_points"
              type="number"
              min={0}
              placeholder="50"
              {...register("bonus_points")}
            />
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Challenge"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
