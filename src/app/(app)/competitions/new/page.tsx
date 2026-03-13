"use client";

import { useRouter } from "next/navigation";
import { useForm, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { addDays, format } from "date-fns";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Swords,
  Trophy,
  Target,
  Zap,
  Timer,
  Coins,
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
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { useCompetitions } from "@/lib/hooks/use-competitions";
import { useMembers } from "@/lib/hooks/use-members";
import { useChores } from "@/lib/hooks/use-chores";
import { cn } from "@/lib/utils/cn";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const createCompetitionSchema = z
  .object({
    opponent_id: z.string().min(1, "Select an opponent"),
    title: z.string().min(1, "Title is required").max(100),
    competition_type: z.enum([
      "most_points",
      "most_completions",
      "first_to_target",
      "specific_chore_race",
    ]),
    target_value: z.coerce.number().min(1).optional(),
    chore_id: z.string().optional(),
    stakes_points: z.coerce.number().min(0).default(0),
    stakes_description: z.string().max(200).optional(),
    duration_days: z.coerce.number().min(1).max(14).default(7),
  })
  .refine(
    (data) => {
      if (data.competition_type === "first_to_target" && !data.target_value) {
        return false;
      }
      return true;
    },
    {
      message: "Target value is required for First to Target competitions",
      path: ["target_value"],
    }
  )
  .refine(
    (data) => {
      if (data.competition_type === "specific_chore_race" && !data.chore_id) {
        return false;
      }
      return true;
    },
    {
      message: "Select a chore for Chore Race competitions",
      path: ["chore_id"],
    }
  );

type FormValues = z.infer<typeof createCompetitionSchema>;

// ---------------------------------------------------------------------------
// Type options
// ---------------------------------------------------------------------------

const COMPETITION_TYPES = [
  {
    value: "most_points",
    label: "Most Points",
    description: "Whoever earns the most points wins",
    icon: Trophy,
    color: "text-amber-400",
  },
  {
    value: "most_completions",
    label: "Most Completions",
    description: "Complete the most chores to win",
    icon: Target,
    color: "text-blue-400",
  },
  {
    value: "first_to_target",
    label: "First to Target",
    description: "Race to reach a target score first",
    icon: Zap,
    color: "text-emerald-400",
  },
  {
    value: "specific_chore_race",
    label: "Chore Race",
    description: "Race to complete a specific chore type",
    icon: Timer,
    color: "text-violet-400",
  },
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function NewCompetitionPage() {
  const router = useRouter();
  const { createCompetition } = useCompetitions();
  const { members, currentMember } = useMembers();
  const { chores } = useChores();

  const otherMembers = members.filter((m) => m.id !== currentMember?.id);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(createCompetitionSchema) as unknown as Resolver<FormValues>,
    defaultValues: {
      title: "",
      opponent_id: "",
      competition_type: "most_points",
      stakes_points: 0,
      stakes_description: "",
      duration_days: 7,
    },
  });

  const competitionType = watch("competition_type");
  const selectedOpponentId = watch("opponent_id");

  const onSubmit = async (values: FormValues) => {
    if (!currentMember) return;

    const now = new Date();
    const endsAt = addDays(now, values.duration_days);

    await createCompetition.mutateAsync({
      challenger_id: currentMember.id,
      opponent_id: values.opponent_id,
      title: values.title,
      competition_type: values.competition_type,
      target_value: values.target_value,
      chore_id: values.chore_id,
      stakes_points: values.stakes_points,
      stakes_description: values.stakes_description,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    });

    router.push("/competitions");
  };

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6 p-4 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/competitions">
            <ArrowLeft className="size-5" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold">New Competition</h1>
          <p className="text-sm text-muted-foreground">
            Challenge a household member
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Opponent Selection */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Choose Your Opponent</CardTitle>
          </CardHeader>
          <CardContent>
            {otherMembers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No other members in this household yet.
              </p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4">
                {otherMembers.map((member) => {
                  const isSelected = selectedOpponentId === member.id;
                  return (
                    <motion.button
                      key={member.id}
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => setValue("opponent_id", member.id)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-lg border p-3 transition-colors",
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border hover:bg-muted/50"
                      )}
                    >
                      <Avatar className="size-10">
                        <AvatarImage
                          src={member.avatar_url ?? undefined}
                          alt={member.display_name}
                        />
                        <AvatarFallback
                          className="text-sm font-semibold text-white"
                          style={{
                            backgroundColor: member.favorite_color,
                          }}
                        >
                          {getInitials(member.display_name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-medium truncate max-w-full">
                        {member.display_name}
                      </span>
                    </motion.button>
                  );
                })}
              </div>
            )}
            {errors.opponent_id && (
              <p className="mt-2 text-xs text-destructive">
                {errors.opponent_id.message}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Competition Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Competition Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {COMPETITION_TYPES.map((type) => {
                const Icon = type.icon;
                const isSelected = competitionType === type.value;
                return (
                  <motion.button
                    key={type.value}
                    type="button"
                    whileTap={{ scale: 0.97 }}
                    onClick={() =>
                      setValue(
                        "competition_type",
                        type.value as FormValues["competition_type"]
                      )
                    }
                    className={cn(
                      "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-muted/50"
                    )}
                  >
                    <Icon className={cn("size-5", type.color)} />
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
                placeholder="Kitchen Showdown"
                {...register("title")}
              />
              {errors.title && (
                <p className="text-xs text-destructive">
                  {errors.title.message}
                </p>
              )}
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
                  <SelectItem value="3">3 days</SelectItem>
                  <SelectItem value="5">5 days</SelectItem>
                  <SelectItem value="7">1 week</SelectItem>
                  <SelectItem value="14">2 weeks</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Target Value (first_to_target) */}
            {competitionType === "first_to_target" && (
              <div className="space-y-2">
                <Label htmlFor="target_value">Target Value</Label>
                <Input
                  id="target_value"
                  type="number"
                  min={1}
                  placeholder="100"
                  {...register("target_value")}
                />
                <p className="text-xs text-muted-foreground">
                  First to reach this score wins
                </p>
                {errors.target_value && (
                  <p className="text-xs text-destructive">
                    {errors.target_value.message}
                  </p>
                )}
              </div>
            )}

            {/* Chore Selection (specific_chore_race) */}
            {competitionType === "specific_chore_race" && (
              <div className="space-y-2">
                <Label>Chore</Label>
                <Select
                  value={watch("chore_id") || ""}
                  onValueChange={(v) => setValue("chore_id", v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a chore" />
                  </SelectTrigger>
                  <SelectContent>
                    {(chores || []).map((chore) => (
                      <SelectItem key={chore.id} value={chore.id}>
                        {chore.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {errors.chore_id && (
                  <p className="text-xs text-destructive">
                    {errors.chore_id.message}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Stakes */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Coins className="size-4 text-amber-400" />
              Stakes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="stakes_points">Points Wager</Label>
              <Input
                id="stakes_points"
                type="number"
                min={0}
                placeholder="50"
                {...register("stakes_points")}
              />
              <p className="text-xs text-muted-foreground">
                Points transferred from loser to winner
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="stakes_description">
                Real-World Stakes (optional)
              </Label>
              <Textarea
                id="stakes_description"
                placeholder="Loser does dishes for a week..."
                rows={2}
                {...register("stakes_description")}
              />
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
            <Swords className="mr-1 size-4" />
            {isSubmitting ? "Sending..." : "Send Challenge"}
          </Button>
        </div>
      </form>
    </div>
  );
}
