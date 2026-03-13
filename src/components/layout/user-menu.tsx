"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/hooks/use-auth";
import { LogOut, Pencil, ChevronRight } from "lucide-react";
import type { Member } from "@/lib/supabase/types";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
} from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";

const ROLE_LABELS: Record<string, string> = {
  parent: "Parent",
  kid: "Kid",
  roommate: "Roommate",
  manager: "Manager",
  colleague: "Colleague",
};

interface UserMenuProps {
  currentMember: Member | null;
  members: Member[];
  role: string;
}

export function UserMenu({ currentMember, members, role }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { signOut } = useAuth();

  const otherMembers = members.filter((m) => m.id !== currentMember?.id);

  const initials = currentMember
    ? currentMember.display_name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : "?";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative rounded-full ring-2 ring-[var(--accent-primary)]/50 ring-offset-2 ring-offset-[var(--bg-primary)] transition-all hover:ring-[var(--accent-primary)] focus-visible:outline-none focus-visible:ring-[var(--accent-primary)]"
          aria-label="User menu"
        >
          <Avatar size="default">
            {currentMember?.avatar_url ? (
              <AvatarImage
                src={currentMember.avatar_url}
                alt={currentMember.display_name}
              />
            ) : null}
            <AvatarFallback
              className="text-xs font-bold text-white"
              style={{ backgroundColor: currentMember?.favorite_color || "#6366f1" }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-72 p-0">
        {/* Current user summary */}
        <div className="flex items-center gap-3 p-4">
          <Avatar size="lg">
            {currentMember?.avatar_url ? (
              <AvatarImage
                src={currentMember.avatar_url}
                alt={currentMember.display_name}
              />
            ) : null}
            <AvatarFallback
              className="text-sm font-bold text-white"
              style={{ backgroundColor: currentMember?.favorite_color || "#6366f1" }}
            >
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-[var(--text-primary)]">
              {currentMember?.display_name}
            </p>
            <Badge variant="secondary" className="text-[10px] mt-0.5">
              {ROLE_LABELS[role] ?? role}
            </Badge>
          </div>
        </div>

        <Separator />

        {/* Edit Profile */}
        <button
          className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
          onClick={() => {
            setOpen(false);
            router.push("/profile");
          }}
        >
          <Pencil className="size-4 text-[var(--text-muted)]" />
          Edit Profile
          <ChevronRight className="ml-auto size-4 text-[var(--text-muted)]" />
        </button>

        {/* Other household members */}
        {otherMembers.length > 0 && (
          <>
            <Separator />
            <div className="px-4 py-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                Household
              </p>
            </div>
            <div className="max-h-40 overflow-y-auto pb-1">
              {otherMembers.slice(0, 8).map((m) => (
                <button
                  key={m.id}
                  className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-hover)]"
                  onClick={() => {
                    setOpen(false);
                    router.push(`/members/${m.id}`);
                  }}
                >
                  <Avatar size="sm">
                    {m.avatar_url ? (
                      <AvatarImage src={m.avatar_url} alt={m.display_name} />
                    ) : null}
                    <AvatarFallback
                      className="text-[10px] font-bold text-white"
                      style={{ backgroundColor: m.favorite_color || "#6366f1" }}
                    >
                      {m.display_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <span className="truncate">{m.display_name}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <Separator />

        {/* Sign Out */}
        <div className="p-2">
          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sm text-[var(--accent-danger)] hover:bg-[var(--accent-danger)]/10 hover:text-[var(--accent-danger)]"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            <LogOut className="size-4" />
            Sign Out
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
