"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v4";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAuth } from "@/lib/hooks/use-auth";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useMembers } from "@/lib/hooks/use-members";
import { cn } from "@/lib/utils/cn";
import { ACCENT_COLORS } from "@/lib/constants/colors";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

import {
  ArrowLeft,
  Camera,
  Loader2,
  LogOut,
  Moon,
  PartyPopper,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Schemas (same as settings page)
// ---------------------------------------------------------------------------
const profileSchema = z.object({
  display_name: z.string().min(1, "Name is required").max(50),
  bio: z.string().max(200, "Bio must be 200 characters or less").optional(),
  birthday: z.string().optional(),
  favorite_color: z.string(),
});

const awaySchema = z.object({
  away_until: z.string().optional(),
  away_reason: z.string().max(200).optional(),
});

type ProfileFormData = z.infer<typeof profileSchema>;
type AwayFormData = z.infer<typeof awaySchema>;

// ===========================================================================
// Profile Page
// ===========================================================================
export default function ProfilePage() {
  const supabase = createClient();
  const queryClient = useQueryClient();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { memberId } = useHouseholdMode();
  const { currentMember } = useMembers();

  const [isAwayEnabled, setIsAwayEnabled] = useState(false);

  // -------------------------------------------------------------------------
  // Profile Form
  // -------------------------------------------------------------------------
  const profileForm = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: "",
      bio: "",
      birthday: "",
      favorite_color: "#6366f1",
    },
  });

  useEffect(() => {
    if (currentMember) {
      profileForm.reset({
        display_name: currentMember.display_name,
        bio: currentMember.bio ?? "",
        birthday: currentMember.birthday ?? "",
        favorite_color: currentMember.favorite_color,
      });
      setIsAwayEnabled(
        !!currentMember.away_until &&
          new Date(currentMember.away_until) > new Date()
      );
    }
  }, [currentMember, profileForm]);

  const updateProfile = useMutation({
    mutationFn: async (data: ProfileFormData) => {
      if (!memberId) throw new Error("No member context");
      const { error } = await supabase
        .from("members")
        .update({
          display_name: data.display_name,
          bio: data.bio || null,
          birthday: data.birthday || null,
          favorite_color: data.favorite_color,
        })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to update profile"
      ),
  });

  // -------------------------------------------------------------------------
  // Avatar Upload
  // -------------------------------------------------------------------------
  const avatarInputRef = useRef<HTMLInputElement>(null);

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      if (!user || !memberId) throw new Error("No user context");

      // Validate file type and size
      const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
      const MAX_SIZE = 5 * 1024 * 1024; // 5MB
      if (!ALLOWED_TYPES.includes(file.type)) {
        throw new Error("Only JPEG, PNG, WebP, and GIF images are allowed");
      }
      if (file.size > MAX_SIZE) {
        throw new Error("Image must be under 5MB");
      }

      const ext = file.name.split(".").pop();
      const path = `avatars/${user.id}/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: updateError } = await supabase
        .from("members")
        .update({ avatar_url: publicUrl })
        .eq("id", memberId);
      if (updateError) throw updateError;

      await supabase
        .from("profiles")
        .update({ avatar_url: publicUrl })
        .eq("id", user.id);
    },
    onSuccess: () => {
      toast.success("Avatar updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
      queryClient.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to upload avatar"
      ),
  });

  // -------------------------------------------------------------------------
  // Away Mode
  // -------------------------------------------------------------------------
  const awayForm = useForm<AwayFormData>({
    resolver: zodResolver(awaySchema),
    defaultValues: { away_until: "", away_reason: "" },
  });

  useEffect(() => {
    if (currentMember) {
      awayForm.reset({
        away_until: currentMember.away_until?.split("T")[0] ?? "",
        away_reason: currentMember.away_reason ?? "",
      });
    }
  }, [currentMember, awayForm]);

  const updateAway = useMutation({
    mutationFn: async (data: AwayFormData & { enabled: boolean }) => {
      if (!memberId) throw new Error("No member context");
      const { error } = await supabase
        .from("members")
        .update({
          away_until:
            data.enabled && data.away_until
              ? new Date(data.away_until).toISOString()
              : null,
          away_reason: data.enabled ? data.away_reason || null : null,
        })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Away status updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to update away status"
      ),
  });

  // -------------------------------------------------------------------------
  // Mute Celebrations
  // -------------------------------------------------------------------------
  const updateMuteCelebrations = useMutation({
    mutationFn: async (muted: boolean) => {
      if (!memberId) throw new Error("No member context");
      const { error } = await supabase
        .from("members")
        .update({ mute_celebrations: muted })
        .eq("id", memberId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Celebration preferences updated");
      queryClient.invalidateQueries({ queryKey: ["members"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update"),
  });

  // -------------------------------------------------------------------------
  // Derived
  // -------------------------------------------------------------------------
  const bioValue = profileForm.watch("bio") ?? "";
  const initials = currentMember
    ? currentMember.display_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "";

  return (
    <div className="mx-auto max-w-lg space-y-6 pb-24 px-4">
      {/* Header */}
      <div className="flex items-center gap-3 pt-6">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="size-5" />
        </Button>
        <h1 className="text-2xl font-bold text-[var(--text-primary)]">
          My Profile
        </h1>
      </div>

      {/* Profile Form */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 space-y-5">
        {/* Avatar */}
        <div className="flex items-center gap-4">
          <div className="relative group">
            <Avatar className="size-16">
              <AvatarImage src={currentMember?.avatar_url ?? undefined} />
              <AvatarFallback
                className="text-lg font-semibold text-white"
                style={{
                  backgroundColor:
                    currentMember?.favorite_color || "#6366f1",
                }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <button
              type="button"
              className="absolute inset-0 flex items-center justify-center rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => avatarInputRef.current?.click()}
            >
              {uploadAvatar.isPending ? (
                <Loader2 className="size-5 text-white animate-spin" />
              ) : (
                <Camera className="size-5 text-white" />
              )}
            </button>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar.mutate(f);
              }}
            />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {currentMember?.display_name}
            </p>
            <p className="text-xs text-[var(--text-muted)]">{user?.email}</p>
          </div>
        </div>

        <form
          onSubmit={profileForm.handleSubmit((d) => updateProfile.mutate(d))}
          className="space-y-5"
        >
          {/* Display Name */}
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)]">
              Display Name
            </Label>
            <Input
              {...profileForm.register("display_name")}
              className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            />
            {profileForm.formState.errors.display_name && (
              <p className="text-xs text-[var(--accent-danger)]">
                {profileForm.formState.errors.display_name.message}
              </p>
            )}
          </div>

          {/* Birthday */}
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)]">Birthday</Label>
            <Input
              type="date"
              {...profileForm.register("birthday")}
              className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
            />
          </div>

          {/* Bio */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[var(--text-secondary)]">Bio</Label>
              <span
                className={cn(
                  "text-xs",
                  bioValue.length > 200
                    ? "text-[var(--accent-danger)]"
                    : "text-[var(--text-muted)]"
                )}
              >
                {bioValue.length}/200
              </span>
            </div>
            <Textarea
              {...profileForm.register("bio")}
              placeholder="Tell your household a bit about you..."
              className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] resize-none h-20"
              maxLength={200}
            />
          </div>

          {/* Favorite Color */}
          <div className="space-y-2">
            <Label className="text-[var(--text-secondary)]">
              Favorite Color
            </Label>
            <div className="grid grid-cols-6 gap-2">
              {ACCENT_COLORS.map((color) => (
                <button
                  type="button"
                  key={color.value}
                  className={cn(
                    "size-10 rounded-full border-2 transition-all",
                    profileForm.watch("favorite_color") === color.value
                      ? "border-white scale-110 ring-2 ring-white/30"
                      : "border-transparent hover:scale-105"
                  )}
                  style={{ backgroundColor: color.value }}
                  onClick={() =>
                    profileForm.setValue("favorite_color", color.value)
                  }
                  title={color.name}
                />
              ))}
            </div>
          </div>

          <Button
            type="submit"
            className="w-full bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
            disabled={updateProfile.isPending}
          >
            {updateProfile.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Save Profile"
            )}
          </Button>
        </form>
      </div>

      {/* Away Mode */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6 space-y-4">
        <div className="flex items-center gap-3 mb-2">
          <Moon className="size-5 text-amber-400" />
          <span className="font-semibold text-[var(--text-primary)]">
            Away Mode
          </span>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Enable Away Mode
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Pause chore assignments while you&apos;re away
            </p>
          </div>
          <Switch
            checked={isAwayEnabled}
            onCheckedChange={(checked) => {
              setIsAwayEnabled(checked);
              if (!checked) {
                updateAway.mutate({ enabled: false });
              }
            }}
          />
        </div>

        {isAwayEnabled && (
          <form
            onSubmit={awayForm.handleSubmit((d) =>
              updateAway.mutate({ ...d, enabled: true })
            )}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)]">
                Away Until
              </Label>
              <Input
                type="date"
                {...awayForm.register("away_until")}
                className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-[var(--text-secondary)]">
                Reason (optional)
              </Label>
              <Input
                {...awayForm.register("away_reason")}
                placeholder="Vacation, business trip..."
                className="border-[var(--border-default)] bg-[var(--bg-tertiary)] text-[var(--text-primary)]"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              className="bg-[var(--accent-primary)] hover:bg-[var(--accent-primary-hover)] text-white"
              disabled={updateAway.isPending}
            >
              {updateAway.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
          </form>
        )}
      </div>

      {/* Celebrations */}
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-6">
        <div className="flex items-center gap-3 mb-4">
          <PartyPopper className="size-5 text-pink-400" />
          <span className="font-semibold text-[var(--text-primary)]">
            Celebrations
          </span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--text-primary)]">
              Mute Celebrations
            </p>
            <p className="text-xs text-[var(--text-muted)]">
              Disable confetti and celebration animations
            </p>
          </div>
          <Switch
            checked={currentMember?.mute_celebrations ?? false}
            onCheckedChange={(checked) =>
              updateMuteCelebrations.mutate(checked)
            }
          />
        </div>
      </div>

      <Separator />

      {/* Sign Out */}
      <Button
        variant="outline"
        className="w-full gap-2 border-[var(--border-default)] text-[var(--accent-danger)] hover:bg-[var(--accent-danger)]/10 hover:text-[var(--accent-danger)]"
        onClick={() => signOut()}
      >
        <LogOut className="size-4" />
        Sign Out
      </Button>
    </div>
  );
}
