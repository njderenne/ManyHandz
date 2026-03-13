import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { redirect } from "next/navigation";
import { JoinHouseholdClient } from "./join-client";
import type { Household } from "@/lib/supabase/types";

interface JoinPageProps {
  params: Promise<{ code: string }>;
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { code } = await params;
  const supabase = await createClient();

  // Fetch household by invite code using service client to bypass RLS
  // (new users aren't members yet, so the anon client can't read households)
  const serviceClient = createServiceClient();
  const { data: household } = await serviceClient
    .from("households")
    .select("id, name, mode, invite_code")
    .eq("invite_code", code.toUpperCase())
    .single();

  // Check if the user is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!household) {
    return <JoinHouseholdClient household={null} isAuthenticated={false} isMember={false} code={code} />;
  }

  // If authenticated, check if already a member
  if (user) {
    const { data: existingMember } = await supabase
      .from("members")
      .select("id")
      .eq("household_id", household.id)
      .eq("user_id", user.id)
      .eq("is_active", true)
      .single();

    if (existingMember) {
      redirect("/dashboard");
    }

    return (
      <JoinHouseholdClient
        household={household as Pick<Household, "id" | "name" | "mode" | "invite_code">}
        isAuthenticated={true}
        isMember={false}
        code={code}
      />
    );
  }

  return (
    <JoinHouseholdClient
      household={household as Pick<Household, "id" | "name" | "mode" | "invite_code">}
      isAuthenticated={false}
      isMember={false}
      code={code}
    />
  );
}
