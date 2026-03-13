"use client";

import { useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ChoreForm } from "@/components/chores/chore-form";
import { useChores } from "@/lib/hooks/use-chores";
import { useHouseholdMode } from "@/lib/hooks/use-household-mode";
import type { Chore } from "@/lib/supabase/types";

export default function NewChorePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { createChore } = useChores();
  const { memberId } = useHouseholdMode();

  // -----------------------------------------------------------------------
  // Pre-fill from template query params
  // -----------------------------------------------------------------------

  const templateChore = useMemo(() => {
    if (searchParams.get("template") !== "true") return null;

    const checklistRaw = searchParams.get("checklist");
    let checklist: Array<{ id: string; label: string; required: boolean }> = [];
    if (checklistRaw) {
      try {
        const steps: string[] = JSON.parse(checklistRaw);
        checklist = steps.map((step) => ({
          id: crypto.randomUUID(),
          label: step,
          required: true,
        }));
      } catch {
        checklist = [];
      }
    }

    return {
      id: "",
      household_id: "",
      category_id: searchParams.get("category") ?? null,
      name: searchParams.get("name") ?? "",
      description: searchParams.get("description") ?? null,
      difficulty: Number(searchParams.get("difficulty") ?? 3),
      estimated_minutes: Number(searchParams.get("estimatedMinutes") ?? 15),
      icon: searchParams.get("icon") ?? "home",
      reference_photo_url: null,
      ai_verification_enabled: false,
      requires_approval: true,
      checklist,
      is_active: true,
      created_by: "",
      created_at: "",
      updated_at: "",
    };
  }, [searchParams]);

  // -----------------------------------------------------------------------
  // Submit handler
  // -----------------------------------------------------------------------

  const handleSubmit = useCallback(
    async (values: any) => {
      await createChore.mutateAsync({
        name: values.name,
        description: values.description || undefined,
        difficulty: values.difficulty,
        estimated_minutes: values.estimated_minutes,
        icon: values.icon,
        category_id: values.category || undefined,
        checklist: values.checklist.map((item: any) => ({
          label: item.label,
          required: item.required,
        })),
        created_by: memberId ?? "",
        ai_verification_enabled: values.ai_verification_enabled,
        requires_approval: values.requires_approval,
      });
      router.push("/chores");
    },
    [createChore, memberId, router]
  );

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-24 sm:p-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => router.back()}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {templateChore ? "New Chore from Template" : "New Chore"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {templateChore
              ? "Customize this template to fit your household"
              : "Create a new chore for your household"}
          </p>
        </div>
      </div>

      {/* Form */}
      <ChoreForm
        chore={templateChore as Chore | null}
        onSubmit={handleSubmit}
        onCancel={() => router.back()}
        isSubmitting={createChore.isPending}
      />
    </div>
  );
}
