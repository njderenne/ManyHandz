"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useHouseholdStore } from "@/lib/stores/household-store";
import { cn } from "@/lib/utils/cn";
import { modeConfigs } from "@/lib/constants/modes";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

import {
  Home,
  Users,
  Building2,
  LogIn,
  UserPlus,
  Loader2,
  AlertTriangle,
  CheckCircle,
  ShieldCheck,
  Gamepad2,
} from "lucide-react";

import type { Household, HouseholdMode } from "@/lib/supabase/types";

interface JoinHouseholdClientProps {
  household: Pick<Household, "id" | "name" | "mode" | "invite_code"> | null;
  isAuthenticated: boolean;
  isMember: boolean;
  code: string;
}

const MODE_ICONS: Record<string, React.ReactNode> = {
  family: <Home className="size-8 text-[var(--accent-primary)]" />,
  roommate: <Users className="size-8 text-[var(--accent-primary)]" />,
  office: <Building2 className="size-8 text-[var(--accent-primary)]" />,
};

export function JoinHouseholdClient({
  household,
  isAuthenticated,
  isMember,
  code,
}: JoinHouseholdClientProps) {
  const router = useRouter();
  const supabase = createClient();
  const queryClient = useQueryClient();
  const [isJoining, setIsJoining] = useState(false);
  const [selectedRole, setSelectedRole] = useState<string | null>(null);

  const modeConfig = household ? modeConfigs[household.mode] : null;
  // Joiners can only pick non-admin roles (exclude creatorRole like "parent" or "manager")
  const joinerRoles = modeConfig
    ? modeConfig.roles.filter((r) => r !== modeConfig.creatorRole)
    : [];
  const showRolePicker = joinerRoles.length > 1;

  const joinHousehold = useMutation({
    mutationFn: async () => {
      if (!household) throw new Error("Invalid household");
      setIsJoining(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      // Get the profile for display name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", user.id)
        .single();

      const mc = modeConfigs[household.mode];
      // Use selected role or fall back to default
      const roleToUse = selectedRole ?? mc?.defaultJoinerRole ?? "roommate";

      const { error } = await supabase.from("members").insert({
        household_id: household.id,
        user_id: user.id,
        display_name: profile?.full_name ?? user.email?.split("@")[0] ?? "Member",
        avatar_url: profile?.avatar_url ?? null,
        role: roleToUse,
        favorite_color: "#6366f1",
        is_active: true,
        bio: null,
        birthday: null,
        venmo_handle: null,
        paypal_handle: null,
        cashapp_handle: null,
        apple_cash_phone: null,
        away_until: null,
        away_reason: null,
        mute_celebrations: false,
        allowance_enabled: false,
        allowance_payout_type: "money" as const,
        allowance_amount_cents: 0,
        allowance_reward_description: null,
        allowance_threshold_pct: 80,
      });

      if (error) {
        // Check if already a member (unique constraint violation)
        if (error.code === "23505") {
          throw new Error("You are already a member of this household");
        }
        throw error;
      }
    },
    onSuccess: () => {
      toast.success("Welcome to the household!");
      if (household) {
        useHouseholdStore.getState().setActiveHousehold(household.id);
      }
      queryClient.invalidateQueries({ queryKey: ["households"] });
      queryClient.invalidateQueries({ queryKey: ["members"] });
      router.push("/dashboard");
    },
    onError: (err) => {
      setIsJoining(false);
      toast.error(err instanceof Error ? err.message : "Failed to join household");
    },
  });

  // Invalid code
  if (!household) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
        <Card className="w-full max-w-md border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
            <AlertTriangle className="size-12 text-amber-400" />
            <h2 className="text-xl font-bold text-[var(--text-primary)]">Invalid Invite Code</h2>
            <p className="text-sm text-[var(--text-muted)]">
              The invite code &quot;{code}&quot; is not valid or has expired. Please ask for a new invite link.
            </p>
            <Button
              variant="outline"
              className="mt-4 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              onClick={() => router.push("/dashboard")}
            >
              Go to Dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const modeLabel = modeConfig?.label ?? household.mode;

  // Not authenticated -- show signup/login options
  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
        <Card className="w-full max-w-md border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <CardHeader className="text-center">
            {MODE_ICONS[household.mode] ?? MODE_ICONS.family}
            <CardTitle className="text-xl text-[var(--text-primary)] mt-4">
              Join {household.name}
            </CardTitle>
            <CardDescription className="text-[var(--text-muted)]">
              You have been invited to join a {modeLabel.toLowerCase()} household
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-center">
              <Badge variant="outline" className="border-[var(--accent-primary)]/30 text-[var(--accent-primary)]">
                {modeLabel} Mode
              </Badge>
            </div>

            <p className="text-center text-sm text-[var(--text-muted)]">
              Sign up or log in to join this household
            </p>

            <div className="space-y-3">
              <Button
                asChild
                className="w-full gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
              >
                <Link href={`/signup?redirect=${encodeURIComponent(`/join/${code}`)}`}>
                  <UserPlus className="size-4" />
                  Sign Up
                </Link>
              </Button>

              <Button
                asChild
                variant="outline"
                className="w-full gap-2 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              >
                <Link href={`/login?redirect=${encodeURIComponent(`/join/${code}`)}`}>
                  <LogIn className="size-4" />
                  Log In
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Authenticated, not yet a member -- show confirmation
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--bg-primary)] p-4">
      <Card className="w-full max-w-md border-[var(--border-default)] bg-[var(--bg-secondary)]">
        <CardHeader className="text-center">
          {MODE_ICONS[household.mode] ?? MODE_ICONS.family}
          <CardTitle className="text-xl text-[var(--text-primary)] mt-4">
            Join {household.name}
          </CardTitle>
          <CardDescription className="text-[var(--text-muted)]">
            You are about to join this {modeLabel.toLowerCase()} household
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-center">
            <Badge variant="outline" className="border-[var(--accent-primary)]/30 text-[var(--accent-primary)]">
              {modeLabel} Mode
            </Badge>
          </div>

          <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] p-4 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Household</span>
              <span className="font-medium text-[var(--text-primary)]">{household.name}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[var(--text-secondary)]">Type</span>
              <span className="text-[var(--text-primary)]">{modeLabel}</span>
            </div>
          </div>

          {/* Role selection for multi-role modes */}
          {showRolePicker && modeConfig && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-[var(--text-primary)]">I am a...</p>
              <div className="grid grid-cols-2 gap-3">
                {joinerRoles.map((r) => {
                  const isParentRole = r === modeConfig.creatorRole;
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setSelectedRole(r)}
                      className={cn(
                        "flex flex-col items-center gap-2 rounded-xl border-2 p-4 transition-all",
                        selectedRole === r
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)]/10"
                          : "border-[var(--border-default)] hover:border-[var(--accent-primary)]/40"
                      )}
                    >
                      {isParentRole ? (
                        <ShieldCheck className="size-6 text-[var(--accent-primary)]" />
                      ) : (
                        <Gamepad2 className="size-6 text-[var(--accent-primary)]" />
                      )}
                      <span className="text-sm font-medium text-[var(--text-primary)] capitalize">{r}</span>
                      <span className="text-[10px] text-[var(--text-muted)] text-center leading-tight">
                        {isParentRole
                          ? "Manage chores & settings"
                          : "Complete chores & earn rewards"}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <Button
            className="w-full gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
            onClick={() => joinHousehold.mutate()}
            disabled={isJoining || (!!showRolePicker && !selectedRole)}
          >
            {isJoining ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <>
                <CheckCircle className="size-4" />
                Join Household
              </>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
