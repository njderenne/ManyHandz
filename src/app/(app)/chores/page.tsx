"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ChoreList } from "@/components/chores/chore-list";
import { ChorePresetSelector } from "@/components/onboarding/chore-preset-selector";
import { useChores } from "@/lib/hooks/use-chores";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import { useAddPresetChores } from "@/lib/hooks/use-add-preset-chores";
import type { Chore, ChoreCategory } from "@/lib/supabase/types";

export default function ChoresPage() {
  const router = useRouter();
  const { chores, isLoading, deleteChore } = useChores();
  const { permissions, memberId } = useHouseholdMode();
  const addPresetChores = useAddPresetChores(memberId);
  const [activeTab, setActiveTab] = useState("my-chores");

  const handleEdit = useCallback(
    (chore: any) => {
      router.push(`/chores/${chore.id}?edit=true`);
    },
    [router]
  );

  const handleDelete = useCallback(
    (choreId: string) => {
      if (window.confirm("Are you sure you want to delete this chore?")) {
        deleteChore.mutate(choreId);
      }
    },
    [deleteChore]
  );

  return (
    <div className="space-y-6 p-4 pb-24 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Chores</h1>
          <p className="text-sm text-muted-foreground">
            Manage your household chore library
          </p>
        </div>
        {permissions.canCreateChores && (
          <Button asChild className="gap-1.5">
            <Link href="/chores/new">
              <Plus className="size-4" />
              New Chore
            </Link>
          </Button>
        )}
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="my-chores">My Chores</TabsTrigger>
          {permissions.canCreateChores && (
            <TabsTrigger value="presets">Add Presets</TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="my-chores" className="mt-4">
          <ChoreList
            chores={chores as Array<Chore & { chore_categories?: ChoreCategory | null }>}
            isLoading={isLoading}
            onEdit={permissions.canEditChores ? handleEdit : undefined}
            onDelete={permissions.canDeleteChores ? handleDelete : undefined}
          />
        </TabsContent>

        {permissions.canCreateChores && (
          <TabsContent value="presets" className="mt-4">
            <ChorePresetSelector
              onSubmit={(templates) =>
                addPresetChores.mutate(templates, {
                  onSuccess: ({ count }) => {
                    toast.success(`Added ${count} chores!`);
                    setActiveTab("my-chores");
                  },
                })
              }
              onSkip={() => setActiveTab("my-chores")}
              isSubmitting={addPresetChores.isPending}
              showSkip={false}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}
