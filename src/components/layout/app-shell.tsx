"use client";

import { useEffect } from "react";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useHouseholds } from "@/lib/hooks/use-households";
import { useSubscription } from "@/lib/hooks/use-subscription";
import { useUIStore } from "@/lib/stores/ui-store";
import { useMembers } from "@/lib/hooks/use-members";
import { Header } from "./header";
import { Sidebar } from "./sidebar";
import { BottomNav } from "./bottom-nav";
import { TrialBanner } from "./trial-banner";
import { cn } from "@/lib/utils/cn";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { navTabs, mode, role, config } = useHouseholdMode();
  const { households, activeHousehold, setActiveHousehold } = useHouseholds();
  const { isTrialing, daysRemaining } = useSubscription();
  const { members, currentMember } = useMembers();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const trialBannerDismissed = useUIStore((s) => s.trialBannerDismissed);
  const dismissTrialBanner = useUIStore((s) => s.dismissTrialBanner);

  // Close sidebar on mobile when route changes
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth < 1024) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [setSidebarOpen]);

  const showTrialBanner = isTrialing && !trialBannerDismissed && daysRemaining !== null;

  return (
    <div className="relative min-h-screen bg-background">
      {/* Trial Banner */}
      {showTrialBanner && (
        <TrialBanner
          daysRemaining={daysRemaining!}
          onDismiss={dismissTrialBanner}
        />
      )}

      {/* Desktop Sidebar */}
      <Sidebar
        navTabs={navTabs}
        mode={mode}
        role={role}
        config={config}
        members={members}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        householdName={activeHousehold?.name ?? ""}
      />

      {/* Main content area */}
      <div
        className={cn(
          "flex min-h-screen flex-col transition-all duration-300",
          // Desktop: offset for sidebar
          sidebarOpen ? "lg:pl-64" : "lg:pl-16",
          // Mobile: no offset, but bottom padding for nav
          "pb-20 lg:pb-0"
        )}
      >
        {/* Header */}
        <Header
          households={households}
          activeHousehold={activeHousehold}
          onSwitchHousehold={(id: string) => setActiveHousehold(id)}
          members={members}
          currentMember={currentMember ?? null}
          mode={mode}
          role={role}
        />

        {/* Page content */}
        <main className="flex-1 px-4 py-6 lg:px-8">
          {children}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <BottomNav navTabs={navTabs} />
    </div>
  );
}
