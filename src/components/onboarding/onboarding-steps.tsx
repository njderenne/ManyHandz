"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  Sparkles,
  CheckCircle2,
  Shield,
  BarChart3,
  Zap,
  Trophy,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils/cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuth } from "@/lib/hooks/use-auth";
import { useUIStore } from "@/lib/stores/ui-store";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { createClient } from "@/lib/supabase/client";
import { createHousehold } from "@/lib/supabase/queries/households";
import { joinHousehold } from "@/lib/supabase/queries/members";
import {
  CreateHousehold,
  type CreateHouseholdData,
} from "./create-household";
import { ChorePresetSelector } from "./chore-preset-selector";
import { useAddPresetChores } from "@/lib/hooks/use-add-preset-chores";

// ---------------------------------------------------------------------------
// Step indicator
// ---------------------------------------------------------------------------
function StepIndicator({
  currentStep,
  totalSteps,
}: {
  currentStep: number;
  totalSteps: number;
}) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: totalSteps }, (_, i) => {
        const step = i + 1;
        const isActive = step === currentStep;
        const isComplete = step < currentStep;
        return (
          <div key={step} className="flex items-center gap-2">
            <div
              className={cn(
                "flex size-8 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                isActive && "bg-primary text-primary-foreground",
                isComplete && "bg-primary/20 text-primary",
                !isActive && !isComplete && "bg-muted text-muted-foreground"
              )}
            >
              {isComplete ? (
                <CheckCircle2 className="size-4" />
              ) : (
                step
              )}
            </div>
            {i < totalSteps - 1 && (
              <div
                className={cn(
                  "h-0.5 w-8 rounded-full transition-colors",
                  step < currentStep ? "bg-primary" : "bg-muted"
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Slide transition variants
// ---------------------------------------------------------------------------
const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 200 : -200,
    opacity: 0,
  }),
  center: { x: 0, opacity: 1 },
  exit: (direction: number) => ({
    x: direction < 0 ? 200 : -200,
    opacity: 0,
  }),
};

// ---------------------------------------------------------------------------
// Feature highlights for trial step
// ---------------------------------------------------------------------------
const trialFeatures = [
  {
    icon: Shield,
    title: "Fair Chore Distribution",
    description: "AI-powered fairness scoring keeps everything balanced.",
  },
  {
    icon: BarChart3,
    title: "Weekly Reports",
    description: "Get detailed breakdowns of who did what each week.",
  },
  {
    icon: Zap,
    title: "Smart Scheduling",
    description: "Auto-rotate tasks with intelligent scheduling.",
  },
  {
    icon: Trophy,
    title: "Gamification",
    description: "Points, streaks, achievements, and leaderboards.",
  },
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export function OnboardingSteps() {
  const router = useRouter();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const setActiveHousehold = useHouseholdStore((s) => s.setActiveHousehold);
  const setOnboardingComplete = useUIStore((s) => s.setOnboardingComplete);

  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [memberRole, setMemberRole] = useState<string | null>(null);

  // Profile form state
  const [displayName, setDisplayName] = useState("");
  const [birthday, setBirthday] = useState("");
  const [bio, setBio] = useState("");
  const [favoriteColor, setFavoriteColor] = useState("#6366f1");

  // -----------------------------------------------------------------------
  // Mutations
  // -----------------------------------------------------------------------
  const createHouseholdMutation = useMutation({
    mutationFn: async (data: CreateHouseholdData) => {
      if (!user) throw new Error("Not authenticated");
      const household = await createHousehold({
        name: data.name,
        mode: data.mode,
        createdBy: user.id,
      });
      if (!household) throw new Error("Failed to create household");

      // Determine creator role from the mode config
      const creatorRole = data.mode === "family" ? "parent" : "roommate";

      const member = await joinHousehold({
        householdId: household.id,
        userId: user.id,
        displayName: user.user_metadata?.full_name ?? user.email ?? "Member",
        role: creatorRole,
      });

      // Create trial subscription
      const supabase = createClient();
      const now = new Date();
      const trialEnd = new Date();
      trialEnd.setDate(trialEnd.getDate() + 14);
      await supabase.from("subscriptions").insert({
        user_id: user.id,
        household_id: household.id,
        status: "trialing",
        trial_start: now.toISOString(),
        trial_end: trialEnd.toISOString(),
        current_period_start: now.toISOString(),
        current_period_end: trialEnd.toISOString(),
      });

      return { household, member };
    },
    onSuccess: ({ household, member }) => {
      const creatorRole = household.mode === "family" ? "parent" : "roommate";
      setHouseholdId(household.id);
      setMemberId(member.id);
      setMemberRole(creatorRole);
      setActiveHousehold(household.id);
      setDisplayName(member.display_name);
      goToStep(2); // creators always see chore setup
      queryClient.invalidateQueries({ queryKey: ["households"] });
    },
  });

  const joinHouseholdMutation = useMutation({
    mutationFn: async ({ householdId: targetHouseholdId, role }: { householdId: string; role: string }) => {
      if (!user) throw new Error("Not authenticated");
      const member = await joinHousehold({
        householdId: targetHouseholdId,
        userId: user.id,
        displayName: user.user_metadata?.full_name ?? user.email ?? "Member",
        role,
      });
      return { householdId: targetHouseholdId, member, role };
    },
    onSuccess: ({ householdId: hId, member, role: joinedRole }) => {
      setHouseholdId(hId);
      setMemberId(member.id);
      setMemberRole(joinedRole);
      setActiveHousehold(hId);
      setDisplayName(member.display_name);
      // Kids skip chore setup (step 2) → go straight to profile
      const isAdmin = joinedRole === "parent" || joinedRole === "roommate" || joinedRole === "manager";
      goToStep(isAdmin ? 2 : 3);
      queryClient.invalidateQueries({ queryKey: ["households"] });
    },
  });

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      if (!memberId) throw new Error("No member ID");
      const supabase = createClient();
      const { error } = await supabase
        .from("members")
        .update({
          display_name: displayName.trim() || "Member",
          birthday: birthday || null,
          bio: bio.trim() || null,
          favorite_color: favoriteColor,
        })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      goToStep(4);
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
  });

  const addPresetChores = useAddPresetChores(memberId);
  const addChoresMutation = {
    ...addPresetChores,
    mutate: (templates: any) =>
      addPresetChores.mutate(templates, { onSuccess: () => goToStep(3) }),
  };

  // -----------------------------------------------------------------------
  // Navigation helpers
  // -----------------------------------------------------------------------
  function goToStep(next: number) {
    setDirection(next > step ? 1 : -1);
    setStep(next);
  }

  function handleFinish() {
    setOnboardingComplete(true);
    router.push("/dashboard");
  }

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  // Kids skip chore setup, so they have 3 steps (1→3→4) instead of 4
  const isAdminRole = memberRole === "parent" || memberRole === "roommate" || memberRole === "manager" || memberRole === null;
  const totalSteps = isAdminRole ? 4 : 3;
  // Map internal step numbers to display step numbers for kids
  const displayStep = !isAdminRole && step >= 3 ? step - 1 : step;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <StepIndicator currentStep={displayStep} totalSteps={totalSteps} />

      <AnimatePresence mode="wait" custom={direction}>
        {/* Step 1: Create or Join */}
        {step === 1 && (
          <motion.div
            key="step-1"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <CreateHousehold
              onCreateSubmit={(data) => createHouseholdMutation.mutate(data)}
              onJoinSubmit={(id, role) => joinHouseholdMutation.mutate({ householdId: id, role })}
              isSubmitting={
                createHouseholdMutation.isPending ||
                joinHouseholdMutation.isPending
              }
            />
            {(createHouseholdMutation.error || joinHouseholdMutation.error) && (
              <p className="mt-4 text-center text-sm text-destructive">
                {(createHouseholdMutation.error as Error)?.message ??
                  (joinHouseholdMutation.error as Error)?.message ??
                  "Something went wrong. Please try again."}
              </p>
            )}
          </motion.div>
        )}

        {/* Step 2: Select Chores */}
        {step === 2 && (
          <motion.div
            key="step-2"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <ChorePresetSelector
              onSubmit={(templates) => addChoresMutation.mutate(templates)}
              onSkip={() => goToStep(3)}
              isSubmitting={addChoresMutation.isPending}
            />
            {addChoresMutation.error && (
              <p className="mt-4 text-center text-sm text-destructive">
                {(addChoresMutation.error as Error)?.message ??
                  "Failed to add chores. Please try again."}
              </p>
            )}
          </motion.div>
        )}

        {/* Step 3: Profile Setup */}
        {step === 3 && (
          <motion.div
            key="step-3"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <Card className="border-border mx-auto max-w-md">
              <CardHeader>
                <CardTitle>Set Up Your Profile</CardTitle>
                <CardDescription>
                  Tell us a bit about yourself so your household knows who you
                  are.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                {/* Display name */}
                <div className="space-y-2">
                  <Label htmlFor="display-name">Display Name</Label>
                  <Input
                    id="display-name"
                    placeholder="e.g. Dad, Alex, Roomie"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    maxLength={30}
                    autoFocus
                  />
                </div>

                {/* Birthday */}
                <div className="space-y-2">
                  <Label htmlFor="birthday">Birthday (optional)</Label>
                  <Input
                    id="birthday"
                    type="date"
                    value={birthday}
                    onChange={(e) => setBirthday(e.target.value)}
                  />
                </div>

                {/* Bio */}
                <div className="space-y-2">
                  <Label htmlFor="bio">Short Bio (optional)</Label>
                  <Input
                    id="bio"
                    placeholder="A sentence about you"
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={120}
                  />
                </div>

                {/* Favorite color */}
                <div className="space-y-2">
                  <Label htmlFor="fav-color">Favorite Color</Label>
                  <div className="flex items-center gap-3">
                    <input
                      id="fav-color"
                      type="color"
                      value={favoriteColor}
                      onChange={(e) => setFavoriteColor(e.target.value)}
                      className="size-9 cursor-pointer rounded-md border border-input bg-transparent p-0.5"
                    />
                    <span className="text-sm text-muted-foreground font-mono">
                      {favoriteColor}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <Button
                    variant="outline"
                    className="flex-1"
                    onClick={() => goToStep(4)}
                  >
                    Skip
                  </Button>
                  <Button
                    className="flex-1"
                    disabled={updateProfileMutation.isPending}
                    onClick={() => updateProfileMutation.mutate()}
                  >
                    {updateProfileMutation.isPending ? "Saving..." : "Continue"}
                  </Button>
                </div>

                {updateProfileMutation.error && (
                  <p className="text-sm text-destructive text-center">
                    {(updateProfileMutation.error as Error)?.message ??
                      "Failed to save profile."}
                  </p>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}

        {/* Step 4: Trial Activation */}
        {step === 4 && (
          <motion.div
            key="step-4"
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <Card className="border-border mx-auto max-w-md text-center">
              <CardHeader>
                <div className="mx-auto mb-2 flex size-14 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="size-7 text-primary" />
                </div>
                <CardTitle className="text-xl">
                  Your 14-Day Free Trial is Active!
                </CardTitle>
                <CardDescription>
                  Enjoy full access to every feature. No credit card required.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Feature highlights */}
                <div className="grid gap-4 sm:grid-cols-2 text-left">
                  {trialFeatures.map((feature) => {
                    const Icon = feature.icon;
                    return (
                      <div
                        key={feature.title}
                        className="flex items-start gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                          <Icon className="size-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {feature.title}
                          </p>
                          <p className="text-xs text-muted-foreground leading-relaxed">
                            {feature.description}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <Button className="w-full" size="lg" onClick={handleFinish}>
                  Get Started
                </Button>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
