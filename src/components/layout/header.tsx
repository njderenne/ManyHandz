"use client";

import { Bell, ChevronDown, Check, Inbox } from "lucide-react";
import type { Member, Household } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
  AvatarGroupCount,
} from "@/components/ui/avatar";
import { UserMenu } from "./user-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface HeaderProps {
  households: any[];
  activeHousehold: any;
  onSwitchHousehold: (id: string) => void;
  members: Member[];
  currentMember: Member | null;
  mode: string;
  role: string;
}

export function Header({
  households,
  activeHousehold,
  onSwitchHousehold,
  members,
  currentMember,
  mode,
  role,
}: HeaderProps) {
  const householdName = activeHousehold?.name ?? "ManyHandz";
  const hasMultipleHouseholds = households.length > 1;
  const today = formatDate(new Date());

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-card/80 backdrop-blur-xl">
      <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-8">
        {/* Left: household name + mode badge + switcher */}
        <div className="flex items-center gap-3 min-w-0">
          {hasMultipleHouseholds ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 min-w-0 rounded-lg px-2 py-1 -ml-2 transition-colors hover:bg-accent" aria-label="Switch household">
                  <h1 className="truncate text-lg font-bold text-foreground">
                    {householdName}
                  </h1>
                  <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Switch Household</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {households.map((h: any) => (
                  <DropdownMenuItem
                    key={h.id}
                    onClick={() => onSwitchHousehold(h.id)}
                    className="flex items-center justify-between"
                  >
                    <span className="truncate">{h.name}</span>
                    {h.id === activeHousehold?.id && (
                      <Check className="size-4 text-primary" />
                    )}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <h1 className="truncate text-lg font-bold text-foreground">
              {householdName}
            </h1>
          )}

          <Badge variant="secondary" className="hidden sm:inline-flex text-[10px]">
            {mode === "family" ? "Family" : mode === "roommate" ? "Roommate" : mode}
          </Badge>
        </div>

        {/* Right: date, avatars, notification bell */}
        <div className="flex items-center gap-4 shrink-0">
          {/* Date (hidden on mobile) */}
          <span className="hidden md:block text-sm text-muted-foreground whitespace-nowrap">
            {today}
          </span>

          {/* User Menu (current member avatar as trigger) */}
          <UserMenu
            currentMember={currentMember}
            members={members}
            role={role}
          />

          {/* Other member avatars (decorative, hidden on mobile) */}
          {members.filter((m) => m.id !== currentMember?.id).length > 0 && (
            <AvatarGroup className="hidden sm:flex">
              {members
                .filter((m) => m.id !== currentMember?.id)
                .slice(0, 4)
                .map((member) => (
                  <Avatar key={member.id} size="sm">
                    {member.avatar_url ? (
                      <AvatarImage
                        src={member.avatar_url}
                        alt={member.display_name}
                      />
                    ) : null}
                    <AvatarFallback>
                      {member.display_name.charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                ))}
              {members.filter((m) => m.id !== currentMember?.id).length > 4 && (
                <AvatarGroupCount>
                  +{members.filter((m) => m.id !== currentMember?.id).length - 4}
                </AvatarGroupCount>
              )}
            </AvatarGroup>
          )}

          {/* Notification bell */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="relative" aria-label="Notifications">
                <Bell className="size-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80 p-0">
              <div className="border-b border-border px-4 py-3">
                <p className="text-sm font-semibold">Notifications</p>
              </div>
              <div className="flex flex-col items-center justify-center gap-2 py-10 px-4 text-center">
                <Inbox className="size-8 text-muted-foreground/50" />
                <p className="text-sm text-muted-foreground">
                  No notifications yet
                </p>
                <p className="text-xs text-muted-foreground/70">
                  You&apos;ll see updates about chores, approvals, and streaks here.
                </p>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </header>
  );
}
