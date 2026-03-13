"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  Home,
  Calendar,
  Scale,
  Gift,
  Settings,
  Target,
  BarChart3,
  CreditCard,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import type { NavTab, ModeConfig } from "@/lib/constants/modes";
import type { Member } from "@/lib/supabase/types";
import { cn } from "@/lib/utils/cn";
import { Badge } from "@/components/ui/badge";
import {
  Avatar,
  AvatarImage,
  AvatarFallback,
  AvatarGroup,
} from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------
const iconMap: Record<string, LucideIcon> = {
  home: Home,
  calendar: Calendar,
  scale: Scale,
  gift: Gift,
  settings: Settings,
  target: Target,
  "bar-chart-3": BarChart3,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
interface SidebarProps {
  navTabs: NavTab[];
  mode: string;
  role: string;
  config: ModeConfig;
  members: Member[];
  isOpen: boolean;
  onToggle: () => void;
  householdName: string;
}

export function Sidebar({
  navTabs,
  mode,
  role,
  config,
  members,
  isOpen,
  onToggle,
  householdName,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 hidden lg:flex flex-col",
        "border-r border-border bg-card transition-all duration-300",
        isOpen ? "w-64" : "w-16"
      )}
    >
      {/* Toggle button */}
      <Button
        variant="ghost"
        size="icon-xs"
        className="absolute -right-3 top-6 z-50 rounded-full border border-border bg-card shadow-sm"
        onClick={onToggle}
        aria-label={isOpen ? "Collapse sidebar" : "Expand sidebar"}
      >
        {isOpen ? (
          <ChevronLeft className="size-3" />
        ) : (
          <ChevronRight className="size-3" />
        )}
      </Button>

      {/* Household name & mode badge */}
      <div className={cn("flex flex-col gap-2 border-b border-border p-4", !isOpen && "items-center")}>
        <AnimatePresence mode="wait">
          {isOpen ? (
            <motion.div
              key="expanded"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col gap-1.5"
            >
              <h2 className="truncate text-sm font-semibold text-foreground">
                {householdName || "My Household"}
              </h2>
              <Badge variant="secondary" className="w-fit text-[10px]">
                {config.label} &middot; {role}
              </Badge>
            </motion.div>
          ) : (
            <motion.div
              key="collapsed"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              <span className="text-lg font-bold text-primary">M</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto p-2">
        <ul className="flex flex-col gap-1">
          {navTabs.map((tab) => {
            const Icon = iconMap[tab.icon] ?? Home;
            const isActive =
              pathname === tab.href ||
              (tab.href !== "/dashboard" && pathname.startsWith(tab.href));

            return (
              <li key={tab.key}>
                <Link
                  href={tab.href}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    !isOpen && "justify-center px-0"
                  )}
                >
                  {isActive && (
                    <motion.div
                      layoutId="sidebar-active"
                      className="absolute inset-0 rounded-lg bg-primary/10"
                      transition={{
                        type: "spring",
                        stiffness: 350,
                        damping: 30,
                      }}
                    />
                  )}
                  <Icon
                    className="relative z-10 size-5 shrink-0"
                    strokeWidth={isActive ? 2.5 : 2}
                  />
                  {isOpen && (
                    <span className="relative z-10 truncate">{tab.label}</span>
                  )}

                  {/* Tooltip for collapsed state */}
                  {!isOpen && (
                    <span className="pointer-events-none absolute left-full ml-2 hidden rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md group-hover:block">
                      {tab.label}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Member avatars row */}
      {isOpen && members.length > 0 && (
        <div className="border-t border-border px-4 py-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Members
          </p>
          <AvatarGroup>
            {members.slice(0, 5).map((member) => (
              <Avatar key={member.id} size="sm">
                {member.avatar_url ? (
                  <AvatarImage src={member.avatar_url} alt={member.display_name} />
                ) : null}
                <AvatarFallback>
                  {member.display_name.charAt(0).toUpperCase()}
                </AvatarFallback>
              </Avatar>
            ))}
            {members.length > 5 && (
              <Avatar size="sm">
                <AvatarFallback className="text-[10px]">
                  +{members.length - 5}
                </AvatarFallback>
              </Avatar>
            )}
          </AvatarGroup>
        </div>
      )}

      {/* Bottom links -- only show to admin roles */}
      {(role === "parent" || role === "roommate" || role === "manager") && (
        <div className={cn("border-t border-border p-2", !isOpen && "flex flex-col items-center")}>
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              !isOpen && "justify-center px-0"
            )}
          >
            <Settings className="size-4 shrink-0" />
            {isOpen && <span>Settings</span>}
          </Link>
          <Link
            href="/billing"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
              !isOpen && "justify-center px-0"
            )}
          >
            <CreditCard className="size-4 shrink-0" />
            {isOpen && <span>Billing</span>}
          </Link>
        </div>
      )}
    </aside>
  );
}
