import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await request.json();
    const { status, denial_reason } = body;

    // Validate status input
    if (!status || !["approved", "denied"].includes(status)) {
      return NextResponse.json(
        { error: "status must be 'approved' or 'denied'" },
        { status: 400 }
      );
    }

    // Get snooze request
    const { data: snoozeRequest } = await supabase
      .from("snooze_requests")
      .select("*, assignments(household_id)")
      .eq("id", id)
      .single();

    if (!snoozeRequest) {
      return NextResponse.json(
        { error: "Snooze request not found" },
        { status: 404 }
      );
    }

    if (snoozeRequest.status !== "pending") {
      return NextResponse.json(
        { error: "Already processed" },
        { status: 400 }
      );
    }

    // Verify user is an admin
    const householdId = (
      snoozeRequest.assignments as Record<string, unknown>
    )?.household_id as string;
    const { data: member } = await supabase
      .from("members")
      .select("id, role")
      .eq("household_id", householdId)
      .eq("user_id", user.id)
      .single();

    if (!member || !["parent", "manager", "roommate"].includes(member.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (status === "approved") {
      // Update snooze request
      const { error: snoozeError } = await supabase
        .from("snooze_requests")
        .update({
          status: "approved",
          reviewed_by: member.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (snoozeError) throw snoozeError;

      // Update assignment with new due date
      const { error: assignError } = await supabase
        .from("assignments")
        .update({
          due_date: snoozeRequest.new_due_date,
          due_time: snoozeRequest.new_due_time,
          status: "pending",
          snooze_count: (snoozeRequest as Record<string, unknown>).snooze_count
            ? ((snoozeRequest as Record<string, unknown>).snooze_count as number) + 1
            : 1,
        })
        .eq("id", snoozeRequest.assignment_id);
      if (assignError) throw assignError;
    } else if (status === "denied") {
      const { error } = await supabase
        .from("snooze_requests")
        .update({
          status: "denied",
          reviewed_by: member.id,
          reviewed_at: new Date().toISOString(),
          denial_reason: denial_reason || "Request denied",
        })
        .eq("id", id);
      if (error) throw error;

      // Restore assignment status
      await supabase
        .from("assignments")
        .update({ status: "pending" })
        .eq("id", snoozeRequest.assignment_id);
    }

    return NextResponse.json({ success: true, status });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
