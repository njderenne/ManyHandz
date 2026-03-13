// ============================================================================
// ManyHandz — Cron: Check Birthdays
// Daily: detects members whose birthday matches today (month/day),
// accounting for the household's configured timezone. Creates activity
// feed entries and sends push notifications to household members.
// ============================================================================

import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { sendPushToHousehold } from "@/lib/utils/push";

export async function POST(request: Request) {
  // Double-check cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();

  try {
    // 1. Get all households with their timezones
    const { data: households, error: hhError } = await supabase
      .from("households")
      .select("id, timezone");

    if (hhError) throw hhError;
    if (!households?.length) {
      return NextResponse.json({
        success: true,
        birthdayCount: 0,
        message: "No households found",
      });
    }

    const birthdayMembers: Array<{
      memberId: string;
      displayName: string;
      householdId: string;
    }> = [];

    for (const household of households) {
      // 2. Determine today's date in the household's timezone
      const tz = household.timezone || "America/New_York";
      let localDate: Date;

      try {
        const formatter = new Intl.DateTimeFormat("en-CA", {
          timeZone: tz,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        // en-CA gives YYYY-MM-DD format
        const dateStr = formatter.format(new Date());
        localDate = new Date(dateStr + "T00:00:00");
      } catch {
        // Fallback to UTC if timezone is invalid
        localDate = new Date();
      }

      const todayMonth = localDate.getMonth() + 1; // 1-indexed
      const todayDay = localDate.getDate();

      // Pad for SQL matching: "MM-DD"
      const monthStr = String(todayMonth).padStart(2, "0");
      const dayStr = String(todayDay).padStart(2, "0");
      const mmdd = `${monthStr}-${dayStr}`;

      // 3. Get active members with a birthday in this household
      //    birthday is stored as a date string (YYYY-MM-DD), we match on MM-DD suffix
      const { data: members, error: membersError } = await supabase
        .from("members")
        .select("id, display_name, birthday, user_id")
        .eq("household_id", household.id)
        .eq("is_active", true)
        .not("birthday", "is", null);

      if (membersError) {
        console.error(
          `Failed to fetch members for household ${household.id}:`,
          membersError
        );
        continue;
      }

      if (!members?.length) continue;

      // Filter members whose birthday month/day matches today
      const todayBirthdayMembers = members.filter((m) => {
        if (!m.birthday) return false;
        // birthday format: "YYYY-MM-DD"
        const parts = m.birthday.split("-");
        if (parts.length < 3) return false;
        const bMonth = parts[1];
        const bDay = parts[2];
        return `${bMonth}-${bDay}` === mmdd;
      });

      if (!todayBirthdayMembers.length) continue;

      // 4. Create activity feed entries and send notifications (idempotent)
      //    Check today's date range to avoid duplicates on re-run
      const todayStart = `${localDate.getFullYear()}-${monthStr}-${dayStr}T00:00:00Z`;
      const todayEnd = `${localDate.getFullYear()}-${monthStr}-${dayStr}T23:59:59Z`;

      for (const member of todayBirthdayMembers) {
        // Idempotency guard: skip if birthday activity already exists today
        const { count: existingCount } = await supabase
          .from("activity_feed")
          .select("id", { count: "exact", head: true })
          .eq("household_id", household.id)
          .eq("member_id", member.id)
          .eq("action_type", "birthday")
          .gte("created_at", todayStart)
          .lte("created_at", todayEnd);

        if ((existingCount ?? 0) > 0) continue; // Already processed today

        birthdayMembers.push({
          memberId: member.id,
          displayName: member.display_name,
          householdId: household.id,
        });

        // Calculate age if year is available
        const birthYear = parseInt(member.birthday!.split("-")[0], 10);
        const currentYear = localDate.getFullYear();
        const age = currentYear - birthYear;

        // Create activity feed entry
        const { error: activityError } = await supabase
          .from("activity_feed")
          .insert({
            household_id: household.id,
            member_id: member.id,
            action_type: "birthday",
            metadata: {
              display_name: member.display_name,
              age: age > 0 && age < 150 ? age : undefined,
            },
            reactions: {},
          });

        if (activityError) {
          console.error(
            `Failed to create birthday activity for member ${member.id}:`,
            activityError
          );
        }

        // Send push notification to household members (exclude the birthday person)
        try {
          await sendPushToHousehold(
            household.id,
            {
              title: "Birthday Today!",
              body: `It's ${member.display_name}'s birthday today! Wish them a happy birthday!`,
              icon: "/icons/birthday.png",
              tag: `birthday-${member.id}-${mmdd}`,
              data: {
                url: `/household`,
                type: "birthday",
                memberId: member.id,
              },
            },
            member.user_id // exclude the birthday member from the notification
          );
        } catch (pushError) {
          console.error(
            `Failed to send birthday push for member ${member.id}:`,
            pushError
          );
        }
      }
    }

    return NextResponse.json({
      success: true,
      birthdayCount: birthdayMembers.length,
      birthdayMembers: birthdayMembers.map((m) => ({
        memberId: m.memberId,
        displayName: m.displayName,
        householdId: m.householdId,
      })),
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error("Cron check-birthdays error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
