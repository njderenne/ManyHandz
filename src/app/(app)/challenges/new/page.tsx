"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDays, format } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Zap,
  Target,
  ShieldCheck,
  Sparkles,
  CalendarIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useChallenges } from "@/lib/hooks/use-challenges";
import { useMembers } from "@/lib/hooks/use-members";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Validation Schema
// ---------------------------------------------------------------------------

const createChallengeSchema = z
  .object({
    title: z.string().min(1, "Title is required").max(100),
    description: z.string().max(500).optional(),
    challenge_type: z.enum([
      "double_points",
      "complete_count",
      "no_overdue",
      "custom",
    ]),
    target_value: z.coerce.number().min(1).optional(),
    bonus_points: z.coerce.number().min(0).default(0),
    points_multiplier: z.coerce.number().min(1).max(10).default(1),
    duration_preset: z.string().default("1"),
    custom_duration_days: z.coerce.number().min(1).max(30).optional(),
    start_date: z.string().min(1, "Start date is required"),
    start_time: z.string().default("00:00"),
    end_date: z.string().optional(),
    end_time: z.string().default("23:59"),
  })
  .refine(
    (data) => {
      if (data.challenge_type === "complete_count" && !data.target_value) {
        return false;
      }
      return true;
    },
    {
      message: "Target value is required for completion count challenges",
      path: ["target_value"],
    }
  );

type FormValues = z.output<typeof createChallengeSchema>;

// ---------------------------------------------------------------------------
// Type options
// ---------------------------------------------------------------------------

const CHALLENGE_TYPES = [
  {
    value: "double_points",
    label: "Double Points",
    description: "Multiply points earned during the challenge period",
    icon: Zap,
    color: "text-amber-400",
  },
  {
    value: "complete_count",
    label: "Completion Count",
    description: "Complete a target number of chores",
    icon: Target,
    color: "text-blue-400",
  },
  {
    value: "no_overdue",
    label: "No Overdue",
    description: "Keep a clean record with zero overdue tasks",
    icon: ShieldCheck,
    color: "text-emerald-400",
  },
  {
    value: "custom",
    label: "Custom",
    description: "Define your own challenge rules",
    icon: Sparkles,
    color: "text-violet-400",
  },
] as const;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewChallengePage() {
  const router = useRouter();
  const { createChallenge } = useChallenges();
  const { currentMember } = useMembers();

  const now = new Date();
  const defaultStartDate = format(now, "yyyy-MM-dd");
  const defaultStartTime = format(now, "HH:mm");

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createChallengeSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      title: "",
      description: "",
      challenge_type: "double_points",
      bonus_points: 0,
      points_multiplier: 2,
      duration_preset: "1",
      start_date: defaultStartDate,
      start_time: defaultStartTime,
      end_time: "23:59",
    },
  });

  const challengeType = watch("challenge_type");
  const durationPreset = watch("duration_preset");

  const onSubmit = async (values: FormValues) => {
    if (!currentMember) return;

    const startsAt = new Date(`${values.start_date}T${values.start_time}:00`);

    let durationDays: number;
    if (values.duration_preset === "custom") {
      durationDays = values.custom_duration_days || 1;
    } else {
      durationDays = Number(values.duration_preset);
    }

    let endsAt: Date;
    if (values.end_date) {
      endsAt = new Date(`${values.end_date}T${values.end_time}:00`);
    } else {
      endsAt = addDays(startsAt, durationDays);
      endsAt.setHours(23, 59, 59, 999);
    }

    await createChallenge.mutateAsync({
      title: values.title,
      description: values.description,
      challenge_type: values.challenge_type,
      target_value: values.target_value,
      bonus_points: values.bonus_points,
      points_multiplier: values.points_multiplier,
      starts_at: startsAt.toISOString(),
      ends_at: endsAt.toISOString(),
      created_by: currentMember.id,
    });

    router.push("/challenges");
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/challenges">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Create Challenge</h1>
          <p className="text-sm text-muted-foreground">
            Set up a new bonus challenge for your household
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Challenge Type Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Challenge Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {CHALLENGE_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = challengeType === type.value;
                return (
                  <motion.button
                    key={type.value}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() =>
                      setValue(
                        "challenge_type",
                        type.value as FormValues["challenge_type"]
                      )
                    }
                    className={`flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    }`}
                  >
                    <Icon className={`size-5 ${type.color}`} />
                    <div>
                      <p className="text-sm font-medium">{type.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {type.description}
                      </p>
                    </div>
                  </motion.button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="title">Title</Label>
              <Input
                id="title"
                placeholder="Weekend Cleaning Sprint"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the challenge rules and goals..."
                rows={3}
                {...register("description")}
              />
              {errors.description && (
                <p className="text-xs text-destructive">
                  {errors.description.message}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Type-specific settings */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Target Value (completion count) */}
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
                <p className="text-xs text-muted-foreground">
                  Number of chores that need to be completed
                </p>
                {errors.target_value && (
                  <p className="text-xs text-destructive">
                    {errors.target_value.message}
                  </p>
                )}
              </div>
            )}

            {/* Points Multiplier (double points) */}
            {challengeType === "double_points" && (
              <div className="space-y-2">
                <Label>Points Multiplier</Label>
                <Select
                  value={String(watch("points_multiplier"))}
                  onValueChange={(v) =>
                    setValue("points_multiplier", Number(v))
                  }
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
                <p className="text-xs text-muted-foreground">
                  All chore completions during this challenge earn multiplied
                  points
                </p>
              </div>
            )}

            {/* Bonus Points */}
            <div className="space-y-2">
              <Label htmlFor="bonus_points">Bonus Points Reward</Label>
              <Input
                id="bonus_points"
                type="number"
                min={0}
                placeholder="50"
                {...register("bonus_points")}
              />
              <p className="text-xs text-muted-foreground">
                Extra points awarded for completing the challenge
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Schedule */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Schedule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Duration preset */}
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select
                value={durationPreset}
                onValueChange={(v) => setValue("duration_preset", v)}
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
                  <SelectItem value="custom">Custom</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Custom duration */}
            {durationPreset === "custom" && (
              <div className="space-y-2">
                <Label htmlFor="custom_duration_days">Days</Label>
                <Input
                  id="custom_duration_days"
                  type="number"
                  min={1}
                  max={30}
                  placeholder="14"
                  {...register("custom_duration_days")}
                />
              </div>
            )}

            <Separator />

            {/* Start date/time */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="start_date">Start Date</Label>
                <Input
                  id="start_date"
                  type="date"
                  {...register("start_date")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time</Label>
                <Input
                  id="start_time"
                  type="time"
                  {...register("start_time")}
                />
              </div>
            </div>

            {/* End date/time (optional override) */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="end_date">End Date (optional)</Label>
                <Input
                  id="end_date"
                  type="date"
                  {...register("end_date")}
                />
                <p className="text-xs text-muted-foreground">
                  Overrides duration
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End Time</Label>
                <Input
                  id="end_time"
                  type="time"
                  {...register("end_time")}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => router.back()}
          >
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={isSubmitting}>
            {isSubmitting ? "Creating..." : "Create Challenge"}
          </Button>
        </div>
      </form>
    </div>
  );
}
