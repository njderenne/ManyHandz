"use client";

import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useHouseholds } from "@/lib/hooks/use-households";
import { useMembers } from "@/lib/hooks/use-members";
import { useHouseholdStore } from "@/lib/stores/household-store";
import Link from "next/link";
import { cn } from "@/lib/utils/cn";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  User,
  Users,
  Fingerprint,
  Wallet,
  Home,
  Bell,
  ShieldAlert,
  LifeBuoy,
  Loader2,
  RefreshCw,
  Trash2,
  LogOut,
  Plus,
  Pencil,
  X,
  Send,
  Upload,
  Check,
  Bot,
  ChevronDown,
  ChevronRight,
  Lock,
  Sliders,
  Shield,
} from "lucide-react";

import type {
  Member,
  Household,
  NotificationPreferences,
  WebauthnCredential,
} from "@/lib/supabase/types";

// ---------------------------------------------------------------------------
// Timezones
// ---------------------------------------------------------------------------
const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Phoenix",
  "America/Toronto",
  "America/Vancouver",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Australia/Sydney",
  "Pacific/Auckland",
  "UTC",
];

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const paymentSchema = z.object({
  venmo_handle: z.string().max(30).optional(),
  paypal_handle: z.string().max(50).optional(),
  cashapp_handle: z.string().max(20).optional(),
  apple_cash_phone: z.string().max(20).optional(),
});

const householdSchema = z.object({
  name: z.string().min(1, "Name is required").max(50),
  timezone: z.string(),
  require_photo_proof: z.boolean(),
  require_approval: z.boolean(),
  leaderboard_visible: z.boolean(),
  allow_kid_gifting: z.boolean(),
  allow_kid_challenges: z.boolean(),
  allow_kid_competitions: z.boolean(),
  max_kid_competition_stakes: z.number().min(0).max(10000),
  ai_verification_enabled: z.boolean(),
  ai_verification_provider: z.enum(["openai", "anthropic"]).nullable(),
  ai_auto_approve_threshold: z.number().min(0).max(100),
  ai_auto_reject_threshold: z.number().min(0).max(100),
  ai_monthly_cost_cap_cents: z.number().min(0).max(100000),
});

const feedbackSchema = z.object({
  subject: z.string().min(1, "Subject is required"),
  message: z
    .string()
    .min(10, "Message must be at least 10 characters")
    .max(2000),
});

const passwordSchema = z
  .object({
    password: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });

type PaymentFormData = z.infer<typeof paymentSchema>;
type HouseholdFormData = z.infer<typeof householdSchema>;
type FeedbackFormData = z.infer<typeof feedbackSchema>;
type PasswordFormData = z.infer<typeof passwordSchema>;

// ---------------------------------------------------------------------------
// Notification toggle keys
// ---------------------------------------------------------------------------
const NOTIFICATION_TOGGLES: {
  key: keyof NotificationPreferences;
  label: string;
}[] = [
  { key: "daily_reminder", label: "Daily Reminder" },
  { key: "overdue_alerts", label: "Overdue Alerts" },
  { key: "chore_completed", label: "Chore Completed" },
  { key: "weekly_digest", label: "Weekly Digest" },
  { key: "reward_notifications", label: "Rewards" },
  { key: "goal_milestones", label: "Goal Milestones" },
  { key: "swap_requests", label: "Swap Requests" },
  { key: "announcements", label: "Announcements" },
  { key: "birthday_notifications", label: "Birthdays" },
  { key: "gift_received", label: "Gifts Received" },
  { key: "challenge_notifications", label: "Challenges" },
  { key: "competition_notifications", label: "Competitions" },
  { key: "ai_verification_notifications", label: "AI Verification" },
  { key: "weekly_report", label: "Weekly Report" },
  { key: "settlement_notifications", label: "Settlements" },
  { key: "comment_notifications", label: "Comments" },
  { key: "shopping_list_notifications", label: "Shopping List" },
];

// ---------------------------------------------------------------------------
// Expandable Card Section (replaces accordion items)
// ---------------------------------------------------------------------------
function SettingsCard({
  icon: Icon,
  iconColor,
  title,
  description,
  badge,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType;
  iconColor: string;
  title: string;
  description?: string;
  badge?: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] overflow-hidden transition-shadow hover:shadow-sm">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left transition-colors hover:bg-[var(--bg-hover)]"
      >
        <div
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-lg",
            iconColor
          )}
        >
          <Icon className="size-4.5 text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--text-primary)]">
            {title}
          </p>
          {description && (
            <p className="text-xs text-[var(--text-muted)] truncate">
              {description}
            </p>
          )}
        </div>
        {badge}
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-[var(--text-muted)] transition-transform duration-200",
            open && "rotate-180"
          )}
        />
      </button>
      {open && (
        <div className="border-t border-[var(--border-default)] px-5 py-5">
          {children}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toggle Row (inline setting row)
// ---------------------------------------------------------------------------
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium text-[var(--text-primary)]">
          {label}
        </p>
        {description && (
          <p className="text-xs text-[var(--text-muted)]">{description}</p>
        )}
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section Header
// ---------------------------------------------------------------------------
function SectionHeader({
  title,
  className,
}: {
  title: string;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        "text-[11px] font-semibold uppercase tracking-wider text-[var(--text-muted)] px-1",
        className
      )}
    >
      {title}
    </h2>
  );
}

// ===========================================================================
// Main Settings Page
// ===========================================================================
export default function SettingsPage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const { user, signOut } = useAuth();
  const { mode, isAdmin, features, memberId } = useHouseholdMode();
  const { activeHousehold } = useHouseholds();
  const { currentMember, members } = useMembers();
  const householdId = useHouseholdStore((s) => s.activeHouseholdId);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  // =========================================================================
  // Passkeys / WebAuthn
  // =========================================================================
  const { data: passkeys = [], isLoading: passkeysLoading } = useQuery({
    queryKey: ["passkeys", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("webauthn_credentials")
        .select("id, user_id, device_type, backed_up, friendly_name, created_at, last_used_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      return (data || []) as WebauthnCredential[];
    },
    enabled: !!user,
  });

  const deletePasskey = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("webauthn_credentials")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Passkey removed");
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: () => toast.error("Failed to remove passkey"),
  });

  const [renamingPasskey, setRenamingPasskey] = useState<string | null>(null);
  const [passkeyNewName, setPasskeyNewName] = useState("");

  const renamePasskey = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      const { error } = await supabase
        .from("webauthn_credentials")
        .update({ friendly_name: name })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Passkey renamed");
      setRenamingPasskey(null);
      setPasskeyNewName("");
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    },
    onError: () => toast.error("Failed to rename passkey"),
  });

  async function handleAddPasskey() {
    try {
      const res = await fetch("/api/auth/webauthn/register-options", {
        method: "POST",
      });
      if (!res.ok) {
        toast.error("Failed to start passkey registration");
        return;
      }
      const options = await res.json();

      const { startRegistration } = await import("@simplewebauthn/browser");
      const credential = await startRegistration({ optionsJSON: options });

      const verifyRes = await fetch("/api/auth/webauthn/register-verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credential }),
      });

      if (!verifyRes.ok) {
        toast.error("Passkey registration failed");
        return;
      }

      toast.success("Passkey registered successfully");
      queryClient.invalidateQueries({ queryKey: ["passkeys"] });
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        toast.error("Passkey registration was cancelled");
      } else {
        toast.error("Failed to register passkey");
      }
    }
  }

  // =========================================================================
  // Payment Handles
  // =========================================================================
  const paymentForm = useForm<PaymentFormData>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      venmo_handle: "",
      paypal_handle: "",
      cashapp_handle: "",
      apple_cash_phone: "",
    },
  });

  useEffect(() => {
    if (currentMember) {
      paymentForm.reset({
        venmo_handle: currentMember.venmo_handle ?? "",
        paypal_handle: currentMember.paypal_handle ?? "",
        cashapp_handle: currentMember.cashapp_handle ?? "",
        apple_cash_phone: currentMember.apple_cash_phone ?? "",
      });
    }
  }, [currentMember, paymentForm]);

  const updatePayment = useMutation({
    mutationFn: async (data: PaymentFormData) => {
      if (!memberId) throw new Error("No member context");
      const { error } = await supabase
        .from("members")
        .update({
          venmo_handle: data.venmo_handle || null,
          paypal_handle: data.paypal_handle || null,
          cashapp_handle: data.cashapp_handle || null,
          apple_cash_phone: data.apple_cash_phone || null,
        })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payment handles updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to update payment handles"
      ),
  });

  // =========================================================================
  // Household Settings (Admin)
  // =========================================================================
  const householdForm = useForm<HouseholdFormData>({
    resolver: zodResolver(householdSchema),
    defaultValues: {
      name: "",
      timezone: "America/New_York",
      require_photo_proof: false,
      require_approval: false,
      leaderboard_visible: true,
      allow_kid_gifting: true,
      allow_kid_challenges: true,
      allow_kid_competitions: true,
      max_kid_competition_stakes: 500,
      ai_verification_enabled: false,
      ai_verification_provider: null,
      ai_auto_approve_threshold: 80,
      ai_auto_reject_threshold: 20,
      ai_monthly_cost_cap_cents: 1000,
    },
  });

  useEffect(() => {
    if (activeHousehold) {
      const h = activeHousehold as unknown as Household;
      householdForm.reset({
        name: h.name,
        timezone: h.timezone,
        require_photo_proof: h.require_photo_proof,
        require_approval: h.require_approval,
        leaderboard_visible: h.leaderboard_visible,
        allow_kid_gifting: h.allow_kid_gifting,
        allow_kid_challenges: h.allow_kid_challenges,
        allow_kid_competitions: h.allow_kid_competitions,
        max_kid_competition_stakes: h.max_kid_competition_stakes,
        ai_verification_enabled: h.ai_verification_enabled,
        ai_verification_provider: h.ai_verification_provider,
        ai_auto_approve_threshold: h.ai_auto_approve_threshold,
        ai_auto_reject_threshold: h.ai_auto_reject_threshold,
        ai_monthly_cost_cap_cents: h.ai_monthly_cost_cap_cents,
      });
    }
  }, [activeHousehold, householdForm]);

  const updateHousehold = useMutation({
    mutationFn: async (data: HouseholdFormData) => {
      if (!householdId) throw new Error("No household context");
      const { error } = await supabase
        .from("households")
        .update({
          name: data.name,
          timezone: data.timezone,
          require_photo_proof: data.require_photo_proof,
          require_approval: data.require_approval,
          leaderboard_visible: data.leaderboard_visible,
          allow_kid_gifting: data.allow_kid_gifting,
          allow_kid_challenges: data.allow_kid_challenges,
          allow_kid_competitions: data.allow_kid_competitions,
          max_kid_competition_stakes: data.max_kid_competition_stakes,
          ai_verification_enabled: data.ai_verification_enabled,
          ai_verification_provider: data.ai_verification_provider,
          ai_auto_approve_threshold: data.ai_auto_approve_threshold,
          ai_auto_reject_threshold: data.ai_auto_reject_threshold,
          ai_monthly_cost_cap_cents: data.ai_monthly_cost_cap_cents,
        })
        .eq("id", householdId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Household settings updated");
      queryClient.invalidateQueries({ queryKey: ["households"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error
          ? err.message
          : "Failed to update household settings"
      ),
  });

  const regenerateInviteCode = useMutation({
    mutationFn: async () => {
      if (!householdId) throw new Error("No household context");
      const newCode = Math.random().toString(36).substring(2, 8).toUpperCase();
      const { error } = await supabase
        .from("households")
        .update({ invite_code: newCode })
        .eq("id", householdId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Invite code regenerated");
      queryClient.invalidateQueries({ queryKey: ["households"] });
    },
    onError: () => toast.error("Failed to regenerate invite code"),
  });

  // =========================================================================
  // Notification Preferences
  // =========================================================================
  const { data: notificationPrefs } = useQuery({
    queryKey: ["notification-preferences", memberId],
    queryFn: async () => {
      if (!memberId) return null;
      const { data } = await supabase
        .from("notification_preferences")
        .select("id, member_id, daily_reminder, overdue_alerts, chore_completed, weekly_digest, reward_notifications, goal_milestones, swap_requests, announcements, birthday_notifications, gift_received, challenge_notifications, competition_notifications, ai_verification_notifications, weekly_report, settlement_notifications, comment_notifications, shopping_list_notifications, push_enabled, email_enabled, reminder_time")
        .eq("member_id", memberId)
        .single();
      return data as NotificationPreferences | null;
    },
    enabled: !!memberId,
  });

  const updateNotification = useMutation({
    mutationFn: async ({ key, value }: { key: string; value: boolean }) => {
      if (!memberId) throw new Error("No member context");
      const { error } = await supabase
        .from("notification_preferences")
        .upsert(
          { member_id: memberId, [key]: value },
          { onConflict: "member_id" }
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["notification-preferences"],
      });
    },
    onError: () => toast.error("Failed to update notification preference"),
  });

  // =========================================================================
  // Change Password
  // =========================================================================
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const changePassword = useMutation({
    mutationFn: async (data: PasswordFormData) => {
      const { error } = await supabase.auth.updateUser({
        password: data.password,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password changed successfully");
      passwordForm.reset();
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to change password"
      ),
  });

  // =========================================================================
  // Delete Account
  // =========================================================================
  const deleteAccount = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
    },
    onSuccess: () => {
      toast.success("Account deleted");
      signOut();
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to delete account"
      ),
  });

  // =========================================================================
  // Feedback
  // =========================================================================
  const feedbackForm = useForm<FeedbackFormData>({
    resolver: zodResolver(feedbackSchema),
    defaultValues: { subject: "", message: "" },
  });

  const [feedbackScreenshot, setFeedbackScreenshot] = useState<File | null>(
    null
  );

  const submitFeedback = useMutation({
    mutationFn: async (data: FeedbackFormData) => {
      let screenshotUrl: string | null = null;
      if (feedbackScreenshot && user) {
        // Validate file type and size
        const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
        const MAX_SIZE = 5 * 1024 * 1024; // 5MB
        if (!ALLOWED_TYPES.includes(feedbackScreenshot.type)) {
          throw new Error("Only JPEG, PNG, WebP, and GIF images are allowed");
        }
        if (feedbackScreenshot.size > MAX_SIZE) {
          throw new Error("Image must be under 5MB");
        }
        const ext = feedbackScreenshot.name.split(".").pop();
        const path = `feedback/${user.id}/${Date.now()}.${ext}`;
        await supabase.storage.from("feedback").upload(path, feedbackScreenshot);
        const {
          data: { publicUrl },
        } = supabase.storage.from("feedback").getPublicUrl(path);
        screenshotUrl = publicUrl;
      }

      const res = await fetch("/api/support/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, screenshotUrl }),
      });
      if (!res.ok) throw new Error("Failed to submit feedback");
    },
    onSuccess: () => {
      toast.success("Feedback submitted, thank you!");
      feedbackForm.reset();
      setFeedbackScreenshot(null);
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to submit feedback"
      ),
  });

  // =========================================================================
  // Derived
  // =========================================================================
  const household = activeHousehold as unknown as Household | undefined;
  const isFamily = mode === "family";
  const isRoommate = mode === "roommate";

  const initials = currentMember
    ? currentMember.display_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "";

  // =========================================================================
  // Render
  // =========================================================================
  return (
    <div className="mx-auto max-w-2xl space-y-8 pb-24 px-4">
      {/* Page Header */}
      <div className="pt-6">
        <h1 className="text-2xl font-bold tracking-tight text-[var(--text-primary)]">
          Settings
        </h1>
        <p className="text-sm text-[var(--text-muted)]">
          Manage your account, household, and preferences
        </p>
      </div>

      {/* ===================================================================
          SECTION: PERSONAL
      =================================================================== */}
      <section className="space-y-3">
        <SectionHeader title="Personal" />

        {/* Profile Link Card */}
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4 transition-all hover:bg-[var(--bg-hover)] hover:shadow-sm"
        >
          <Avatar className="size-10">
            {currentMember?.avatar_url ? (
              <AvatarImage
                src={currentMember.avatar_url}
                alt={currentMember.display_name}
              />
            ) : null}
            <AvatarFallback
              className="text-sm font-bold text-white"
              style={{
                backgroundColor:
                  currentMember?.favorite_color || "#6366f1",
              }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {currentMember?.display_name ?? "Your Profile"}
            </p>
            <p className="text-xs text-[var(--text-muted)] truncate">
              {user?.email ?? "Edit avatar, name, bio, and preferences"}
            </p>
          </div>
          <ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" />
        </Link>

        {/* Passkeys */}
        <SettingsCard
          icon={Fingerprint}
          iconColor="bg-emerald-500"
          title="Passkeys"
          description="Sign in with biometrics or security keys"
          badge={
            passkeys.length > 0 ? (
              <Badge variant="secondary" className="text-[10px]">
                {passkeys.length}
              </Badge>
            ) : null
          }
        >
          <div className="space-y-4">
            {passkeysLoading ? (
              <div className="flex justify-center py-4">
                <Loader2 className="size-5 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : passkeys.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] py-2">
                No passkeys registered yet.
              </p>
            ) : (
              <div className="space-y-2">
                {passkeys.map((pk) => (
                  <div
                    key={pk.id}
                    className="flex items-center justify-between rounded-lg border border-[var(--border-default)] bg-[var(--bg-tertiary)] px-3 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <Fingerprint className="size-4 text-[var(--text-muted)]" />
                      <div>
                        {renamingPasskey === pk.id ? (
                          <div className="flex items-center gap-2">
                            <Input
                              value={passkeyNewName}
                              onChange={(e) =>
                                setPasskeyNewName(e.target.value)
                              }
                              className="h-7 w-40 text-sm border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  renamePasskey.mutate({
                                    id: pk.id,
                                    name: passkeyNewName,
                                  });
                                }
                              }}
                            />
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() =>
                                renamePasskey.mutate({
                                  id: pk.id,
                                  name: passkeyNewName,
                                })
                              }
                            >
                              <Check className="size-3" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-6"
                              onClick={() => setRenamingPasskey(null)}
                            >
                              <X className="size-3" />
                            </Button>
                          </div>
                        ) : (
                          <>
                            <p className="text-sm font-medium text-[var(--text-primary)]">
                              {pk.friendly_name ||
                                pk.device_type ||
                                "Passkey"}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              Added{" "}
                              {new Date(pk.created_at).toLocaleDateString()}
                            </p>
                          </>
                        )}
                      </div>
                    </div>
                    {renamingPasskey !== pk.id && (
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                          onClick={() => {
                            setRenamingPasskey(pk.id);
                            setPasskeyNewName(pk.friendly_name ?? "");
                          }}
                        >
                          <Pencil className="size-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-[var(--text-muted)] hover:text-red-400"
                          onClick={() => deletePasskey.mutate(pk.id)}
                        >
                          <Trash2 className="size-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button
              variant="outline"
              size="sm"
              className="gap-2 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              onClick={handleAddPasskey}
            >
              <Plus className="size-4" />
              Add Passkey
            </Button>
          </div>
        </SettingsCard>

        {/* Payment Handles */}
        {features.paymentHandles && (
          <SettingsCard
            icon={Wallet}
            iconColor="bg-cyan-500"
            title="Payment Handles"
            description="Venmo, PayPal, Cash App, Apple Cash"
          >
            <form
              onSubmit={paymentForm.handleSubmit((d) =>
                updatePayment.mutate(d)
              )}
              className="space-y-4"
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label className="text-[var(--text-secondary)]">Venmo</Label>
                  <Input
                    {...paymentForm.register("venmo_handle")}
                    placeholder="@username"
                    className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[var(--text-secondary)]">PayPal</Label>
                  <Input
                    {...paymentForm.register("paypal_handle")}
                    placeholder="paypal.me username"
                    className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[var(--text-secondary)]">
                    Cash App
                  </Label>
                  <Input
                    {...paymentForm.register("cashapp_handle")}
                    placeholder="$cashtag"
                    className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-[var(--text-secondary)]">
                    Apple Cash
                  </Label>
                  <Input
                    {...paymentForm.register("apple_cash_phone")}
                    placeholder="Phone number"
                    className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                  />
                </div>
              </div>
              <Button
                type="submit"
                size="sm"
                className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                disabled={updatePayment.isPending}
              >
                {updatePayment.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Save Payment Handles"
                )}
              </Button>
            </form>
          </SettingsCard>
        )}
      </section>

      {/* ===================================================================
          SECTION: HOUSEHOLD (Admin Only)
      =================================================================== */}
      {isAdmin && household && (
        <section className="space-y-3">
          <SectionHeader title="Household" />

          {/* Household Details */}
          <SettingsCard
            icon={Home}
            iconColor="bg-violet-500"
            title="Household Details"
            description={`${household.name} · ${mode.charAt(0).toUpperCase() + mode.slice(1)} mode`}
          >
            <form
              onSubmit={householdForm.handleSubmit((d) =>
                updateHousehold.mutate(d)
              )}
              className="space-y-5"
            >
              {/* Name */}
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">
                  Household Name
                </Label>
                <Input
                  {...householdForm.register("name")}
                  className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
              </div>

              {/* Mode (read-only) */}
              <div className="flex items-center justify-between">
                <Label className="text-[var(--text-secondary)]">Mode</Label>
                <Badge
                  variant="outline"
                  className="border-[var(--accent-primary)]/30 text-[var(--accent-primary)]"
                >
                  {mode.charAt(0).toUpperCase() + mode.slice(1)}
                </Badge>
              </div>

              {/* Invite Code */}
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">
                  Invite Code
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    value={household.invite_code}
                    readOnly
                    className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-mono tracking-wider cursor-not-allowed"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                    onClick={() => regenerateInviteCode.mutate()}
                    disabled={regenerateInviteCode.isPending}
                  >
                    <RefreshCw
                      className={cn(
                        "size-4",
                        regenerateInviteCode.isPending && "animate-spin"
                      )}
                    />
                  </Button>
                </div>
              </div>

              {/* Timezone */}
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">Timezone</Label>
                <Select
                  value={householdForm.watch("timezone")}
                  onValueChange={(v) => householdForm.setValue("timezone", v)}
                >
                  <SelectTrigger className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEZONES.map((tz) => (
                      <SelectItem key={tz} value={tz}>
                        {tz}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
                disabled={updateHousehold.isPending}
              >
                {updateHousehold.isPending ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Save Household Settings"
                )}
              </Button>
            </form>
          </SettingsCard>

          {/* Chore Rules — Inline Toggles (no accordion needed) */}
          <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4">
            <div className="flex items-center gap-3 mb-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-amber-500">
                <Sliders className="size-4.5 text-white" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[var(--text-primary)]">
                  Chore Rules
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  Completion and verification rules
                </p>
              </div>
            </div>
            <div className="space-y-1">
              <ToggleRow
                label="Require Photo Proof"
                description="Members must upload photos when completing chores"
                checked={householdForm.watch("require_photo_proof")}
                onCheckedChange={(v) =>
                  householdForm.setValue("require_photo_proof", v)
                }
              />
              {isFamily && (
                <ToggleRow
                  label="Require Approval"
                  description="Parents must approve chore completions"
                  checked={householdForm.watch("require_approval")}
                  onCheckedChange={(v) =>
                    householdForm.setValue("require_approval", v)
                  }
                />
              )}
              <ToggleRow
                label="Show Leaderboard"
                description="Display rankings and points leaderboard"
                checked={householdForm.watch("leaderboard_visible")}
                onCheckedChange={(v) =>
                  householdForm.setValue("leaderboard_visible", v)
                }
              />
            </div>
          </div>

          {/* Family Permissions */}
          {isFamily && (
            <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4">
              <div className="flex items-center gap-3 mb-3">
                <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-pink-500">
                  <Shield className="size-4.5 text-white" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[var(--text-primary)]">
                    Kid Permissions
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    Control what kids can do
                  </p>
                </div>
              </div>
              <div className="space-y-1">
                <ToggleRow
                  label="Kid Gifting"
                  description="Allow kids to gift points to each other"
                  checked={householdForm.watch("allow_kid_gifting")}
                  onCheckedChange={(v) =>
                    householdForm.setValue("allow_kid_gifting", v)
                  }
                />
                <ToggleRow
                  label="Kid Challenges"
                  description="Allow kids to create bonus challenges"
                  checked={householdForm.watch("allow_kid_challenges")}
                  onCheckedChange={(v) =>
                    householdForm.setValue("allow_kid_challenges", v)
                  }
                />
                <ToggleRow
                  label="Kid Competitions"
                  description="Allow kids to create head-to-head competitions"
                  checked={householdForm.watch("allow_kid_competitions")}
                  onCheckedChange={(v) =>
                    householdForm.setValue("allow_kid_competitions", v)
                  }
                />
                {householdForm.watch("allow_kid_competitions") && (
                  <div className="space-y-2 pt-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-[var(--text-secondary)]">
                        Max Competition Stakes
                      </Label>
                      <span className="text-sm font-medium text-[var(--text-primary)]">
                        {householdForm.watch("max_kid_competition_stakes")} pts
                      </span>
                    </div>
                    <Slider
                      value={[
                        householdForm.watch("max_kid_competition_stakes"),
                      ]}
                      onValueChange={([v]) =>
                        householdForm.setValue("max_kid_competition_stakes", v)
                      }
                      min={0}
                      max={10000}
                      step={50}
                      className="w-full"
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* AI Verification */}
          {features.aiVerification && (
            <SettingsCard
              icon={Bot}
              iconColor="bg-indigo-500"
              title="AI Verification"
              description="Use AI to verify photo proof"
            >
              <div className="space-y-4">
                <ToggleRow
                  label="Enable AI Verification"
                  description="Automatically verify chore completion photos"
                  checked={householdForm.watch("ai_verification_enabled")}
                  onCheckedChange={(v) =>
                    householdForm.setValue("ai_verification_enabled", v)
                  }
                />

                {householdForm.watch("ai_verification_enabled") && (
                  <div className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label className="text-[var(--text-secondary)]">
                        AI Provider
                      </Label>
                      <Select
                        value={
                          householdForm.watch("ai_verification_provider") ??
                          "openai"
                        }
                        onValueChange={(v) =>
                          householdForm.setValue(
                            "ai_verification_provider",
                            v as "openai" | "anthropic"
                          )
                        }
                      >
                        <SelectTrigger className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="openai">OpenAI</SelectItem>
                          <SelectItem value="anthropic">Anthropic</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[var(--text-secondary)]">
                          Auto-Approve Threshold
                        </Label>
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {householdForm.watch("ai_auto_approve_threshold")}%
                        </span>
                      </div>
                      <Slider
                        value={[
                          householdForm.watch("ai_auto_approve_threshold"),
                        ]}
                        onValueChange={([v]) =>
                          householdForm.setValue("ai_auto_approve_threshold", v)
                        }
                        min={50}
                        max={100}
                        step={5}
                      />
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label className="text-[var(--text-secondary)]">
                          Auto-Reject Threshold
                        </Label>
                        <span className="text-sm font-medium text-[var(--text-primary)]">
                          {householdForm.watch("ai_auto_reject_threshold")}%
                        </span>
                      </div>
                      <Slider
                        value={[
                          householdForm.watch("ai_auto_reject_threshold"),
                        ]}
                        onValueChange={([v]) =>
                          householdForm.setValue("ai_auto_reject_threshold", v)
                        }
                        min={0}
                        max={50}
                        step={5}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-[var(--text-secondary)]">
                        Monthly Cost Cap (cents)
                      </Label>
                      <Input
                        type="number"
                        {...householdForm.register("ai_monthly_cost_cap_cents", {
                          valueAsNumber: true,
                        })}
                        className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                      />
                      <p className="text-xs text-[var(--text-muted)]">
                        Max AI spend per month: $
                        {(
                          householdForm.watch("ai_monthly_cost_cap_cents") / 100
                        ).toFixed(2)}
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </SettingsCard>
          )}

          {/* Members Link */}
          <Link
            href="/members"
            className="flex items-center gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4 transition-all hover:bg-[var(--bg-hover)] hover:shadow-sm"
          >
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-blue-500">
              <Users className="size-4.5 text-white" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Members
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                Manage household members
              </p>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex -space-x-2">
                {members.slice(0, 4).map((m: Member) => (
                  <Avatar
                    key={m.id}
                    className="size-6 border-2 border-[var(--bg-secondary)]"
                  >
                    <AvatarImage src={m.avatar_url ?? undefined} />
                    <AvatarFallback className="text-[10px]">
                      {(m.display_name || "?")[0]}
                    </AvatarFallback>
                  </Avatar>
                ))}
              </div>
              <Badge variant="secondary" className="text-xs">
                {members.length}
              </Badge>
              <ChevronRight className="size-4 text-[var(--text-muted)]" />
            </div>
          </Link>

          {/* Save All Household Changes */}
          <Button
            className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
            onClick={householdForm.handleSubmit((d) =>
              updateHousehold.mutate(d)
            )}
            disabled={updateHousehold.isPending}
          >
            {updateHousehold.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Save All Household Changes"
            )}
          </Button>
        </section>
      )}

      {/* ===================================================================
          SECTION: NOTIFICATIONS
      =================================================================== */}
      <section className="space-y-3">
        <SectionHeader title="Notifications" />

        {/* Delivery Methods — Inline */}
        <div className="rounded-xl border border-[var(--border-default)] bg-[var(--bg-secondary)] px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-yellow-500">
              <Bell className="size-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                Delivery
              </p>
              <p className="text-xs text-[var(--text-muted)]">
                How you receive notifications
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <ToggleRow
              label="Push Notifications"
              description="Receive push notifications on this device"
              checked={notificationPrefs?.push_enabled ?? true}
              onCheckedChange={(v) =>
                updateNotification.mutate({ key: "push_enabled", value: v })
              }
            />
            <ToggleRow
              label="Email Notifications"
              description="Receive email digests and alerts"
              checked={notificationPrefs?.email_enabled ?? true}
              onCheckedChange={(v) =>
                updateNotification.mutate({ key: "email_enabled", value: v })
              }
            />
          </div>
        </div>

        {/* Notification Categories — Expandable, 2-column grid */}
        <SettingsCard
          icon={Sliders}
          iconColor="bg-orange-500"
          title="Notification Categories"
          description="Fine-tune which notifications you receive"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1">
            {NOTIFICATION_TOGGLES.map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between py-2"
              >
                <p className="text-sm text-[var(--text-primary)]">{label}</p>
                <Switch
                  checked={(notificationPrefs?.[key] as boolean) ?? true}
                  onCheckedChange={(v) =>
                    updateNotification.mutate({ key, value: v })
                  }
                />
              </div>
            ))}
          </div>
        </SettingsCard>
      </section>

      {/* ===================================================================
          SECTION: ACCOUNT
      =================================================================== */}
      <section className="space-y-3">
        <SectionHeader title="Account" />

        {/* Change Password */}
        <SettingsCard
          icon={Lock}
          iconColor="bg-slate-500"
          title="Change Password"
          description="Update your account password"
        >
          <form
            onSubmit={passwordForm.handleSubmit((d) =>
              changePassword.mutate(d)
            )}
            className="space-y-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">
                  New Password
                </Label>
                <Input
                  type="password"
                  {...passwordForm.register("password")}
                  className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-xs text-[var(--accent-danger)]">
                    {passwordForm.formState.errors.password.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label className="text-[var(--text-secondary)]">
                  Confirm Password
                </Label>
                <Input
                  type="password"
                  {...passwordForm.register("confirmPassword")}
                  className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-[var(--accent-danger)]">
                    {passwordForm.formState.errors.confirmPassword.message}
                  </p>
                )}
              </div>
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              className="border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
              disabled={changePassword.isPending}
            >
              {changePassword.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Update Password"
              )}
            </Button>
          </form>
        </SettingsCard>

        {/* Support & Feedback */}
        <SettingsCard
          icon={LifeBuoy}
          iconColor="bg-blue-500"
          title="Support & Feedback"
          description="Report bugs or suggest features"
        >
          <form
            onSubmit={feedbackForm.handleSubmit((d) =>
              submitFeedback.mutate(d)
            )}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)]">Subject</Label>
              <Select
                value={feedbackForm.watch("subject")}
                onValueChange={(v) => feedbackForm.setValue("subject", v)}
              >
                <SelectTrigger className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]">
                  <SelectValue placeholder="Select a topic" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bug">Bug Report</SelectItem>
                  <SelectItem value="feature">Feature Request</SelectItem>
                  <SelectItem value="billing">Billing Issue</SelectItem>
                  <SelectItem value="account">Account Issue</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
              {feedbackForm.formState.errors.subject && (
                <p className="text-xs text-[var(--accent-danger)]">
                  {feedbackForm.formState.errors.subject.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)]">Message</Label>
              <Textarea
                {...feedbackForm.register("message")}
                placeholder="Describe your issue or suggestion..."
                className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] resize-none h-28"
              />
              {feedbackForm.formState.errors.message && (
                <p className="text-xs text-[var(--accent-danger)]">
                  {feedbackForm.formState.errors.message.message}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)]">
                Screenshot (optional)
              </Label>
              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
                  onClick={() =>
                    document.getElementById("screenshot-input")?.click()
                  }
                >
                  <Upload className="size-4" />
                  Upload
                </Button>
                {feedbackScreenshot && (
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <span className="truncate max-w-[150px]">
                      {feedbackScreenshot.name}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-5"
                      onClick={() => setFeedbackScreenshot(null)}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                )}
                <input
                  id="screenshot-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) =>
                    setFeedbackScreenshot(e.target.files?.[0] ?? null)
                  }
                />
              </div>
            </div>

            <Button
              type="submit"
              className="w-full gap-2 bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
              disabled={submitFeedback.isPending}
            >
              {submitFeedback.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <>
                  <Send className="size-4" />
                  Submit Feedback
                </>
              )}
            </Button>
          </form>
        </SettingsCard>

        <Separator className="bg-[var(--border-default)]" />

        {/* Sign Out */}
        <Button
          variant="outline"
          className="w-full gap-2 border-[var(--border-default)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)]"
          onClick={() => signOut()}
        >
          <LogOut className="size-4" />
          Sign Out
        </Button>

        {/* Danger Zone */}
        <div className="rounded-xl border border-red-500/20 bg-[var(--bg-secondary)] px-5 py-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-red-500">
              <ShieldAlert className="size-4.5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-red-400">Danger Zone</p>
              <p className="text-xs text-[var(--text-muted)]">
                Permanent, irreversible actions
              </p>
            </div>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Permanently delete your account and all associated data. This action
            cannot be undone.
          </p>
          <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
            <DialogTrigger asChild>
              <Button
                variant="outline"
                className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
              >
                <Trash2 className="size-4" />
                Delete Account
              </Button>
            </DialogTrigger>
            <DialogContent className="border-[var(--border-default)] bg-[var(--bg-secondary)]">
              <DialogHeader>
                <DialogTitle className="text-red-400">
                  Delete Account
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm text-[var(--text-secondary)]">
                  This will permanently delete your account and remove you from
                  all households. Type{" "}
                  <span className="font-mono font-bold text-red-400">
                    DELETE
                  </span>{" "}
                  to confirm.
                </p>
                <Input
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder='Type "DELETE" to confirm'
                  className="border-red-500/30 bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
                />
                <Button
                  variant="destructive"
                  className="w-full"
                  disabled={
                    deleteConfirmText !== "DELETE" || deleteAccount.isPending
                  }
                  onClick={() => deleteAccount.mutate()}
                >
                  {deleteAccount.isPending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Permanently Delete Account"
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </section>
    </div>
  );
}
