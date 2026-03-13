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

    // Verify the user is assigned to this assignment
    const { data: assignment } = await supabase
      .from("assignments")
      .select("*, members!assigned_to(user_id)")
      .eq("id", id)
      .single();

    if (!assignment) {
      return NextResponse.json(
        { error: "Assignment not found" },
        { status: 404 }
      );
    }

    const assignedMember = assignment.members as Record<string, unknown>;
    if (assignedMember?.user_id !== user.id) {
      return NextResponse.json(
        { error: "Not your assignment" },
        { status: 403 }
      );
    }

    if (assignment.status !== "pending" && assignment.status !== "overdue") {
      return NextResponse.json(
        { error: "Cannot start this assignment" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("assignments")
      .update({
        status: "in_progress",
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
