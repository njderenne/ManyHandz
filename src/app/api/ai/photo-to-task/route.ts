// ============================================================================
// ManyHandz — AI: Photo to Task
// Analyzes a photo to generate chores, shopping items, or receipt items.
// Supports three modes: messy_room, empty_shelf, receipt.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyHouseholdMembership } from "@/lib/utils/auth-checks";
import { rateLimitAI, rateLimitResponse } from "@/lib/utils/rate-limit";
import OpenAI from "openai";

interface PhotoToTaskRequest {
  imageBase64: string;
  mode: "messy_room" | "empty_shelf" | "receipt";
  householdId?: string;
}

interface MessyRoomResult {
  chore: {
    name: string;
    description: string;
    difficulty: number;
    estimated_minutes: number;
    category: string;
    subtasks: Array<{ label: string; required: boolean }>;
  };
}

interface EmptyShelfResult {
  items: Array<{
    name: string;
    quantity: string | null;
    category: string;
    note: string | null;
  }>;
}

interface ReceiptResult {
  items: Array<{
    name: string;
    quantity: string;
    price: string | null;
  }>;
  store_name: string | null;
  total: string | null;
}

type PhotoTaskResult =
  | { mode: "messy_room"; data: MessyRoomResult }
  | { mode: "empty_shelf"; data: EmptyShelfResult }
  | { mode: "receipt"; data: ReceiptResult };

const MODE_PROMPTS: Record<string, string> = {
  messy_room: `You are a household cleaning AI for ManyHandz. Analyze this photo of a messy room or area and create a chore to clean it.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "chore": {
    "name": "<descriptive chore name e.g. 'Clean Up Living Room'>",
    "description": "<detailed description of what needs to be done>",
    "difficulty": <1-5, 1=easy 5=expert>,
    "estimated_minutes": <realistic time estimate>,
    "category": "<Kitchen|Bathroom|Living Areas|Bedroom|Outdoor|Laundry|Pets|General>",
    "subtasks": [
      { "label": "<specific subtask>", "required": true },
      ...
    ]
  }
}

Create 3-8 specific subtasks based on what you see in the photo. Be practical and specific.`,

  empty_shelf: `You are a household management AI for ManyHandz. Analyze this photo of an empty or nearly empty shelf/pantry/fridge and identify items that need to be restocked.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "items": [
    {
      "name": "<item name>",
      "quantity": "<suggested quantity or null>",
      "category": "<produce|dairy|meat|bakery|frozen|pantry|beverages|snacks|cleaning|household|personal|pets|other>",
      "note": "<any note or null>"
    }
  ]
}

Identify 3-15 items that likely need restocking based on what you can see (or infer from empty spaces).`,

  receipt: `You are a household management AI for ManyHandz. Analyze this photo of a receipt and extract the purchased items.

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "items": [
    {
      "name": "<item name>",
      "quantity": "<quantity>",
      "price": "<price or null>"
    }
  ],
  "store_name": "<store name or null>",
  "total": "<total amount or null>"
}

Extract all visible items from the receipt. Clean up abbreviated names into readable form.`,
};

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimitAI(user.id);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const body = (await request.json()) as PhotoToTaskRequest;
    const { imageBase64, mode, householdId } = body;

    if (!imageBase64 || !mode) {
      return NextResponse.json(
        { error: "imageBase64 and mode required" },
        { status: 400 }
      );
    }

    // Limit base64 payload size to prevent memory exhaustion (10MB max)
    const MAX_BASE64_LENGTH = 10 * 1024 * 1024 * 1.37; // ~10MB accounting for base64 overhead
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return NextResponse.json(
        { error: "Image too large (max 10MB)" },
        { status: 400 }
      );
    }

    if (!["messy_room", "empty_shelf", "receipt"].includes(mode)) {
      return NextResponse.json(
        { error: "mode must be messy_room, empty_shelf, or receipt" },
        { status: 400 }
      );
    }

    // Verify household membership and check cost cap if householdId provided
    if (householdId) {
      // Verify user is an active member of this household
      const member = await verifyHouseholdMembership(supabase, user.id, householdId);
      if (!member) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const serviceClient = createServiceClient();
      const { data: household } = await serviceClient
        .from("households")
        .select("ai_monthly_cost_cap_cents")
        .eq("id", householdId)
        .single();

      if (household) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const { data: monthlyVerifications } = await serviceClient
          .from("ai_verifications")
          .select("cost_cents, completions!inner(assignments!inner(household_id))")
          .eq("completions.assignments.household_id", householdId)
          .gte("created_at", startOfMonth.toISOString());

        const totalCostCents = (monthlyVerifications ?? []).reduce(
          (sum, v) => sum + (v.cost_cents ?? 0),
          0
        );

        if (totalCostCents >= (household.ai_monthly_cost_cap_cents ?? 500)) {
          return NextResponse.json(
            { error: "Monthly AI cost cap reached" },
            { status: 429 }
          );
        }
      }
    }

    const prompt = MODE_PROMPTS[mode];
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const imageUrl = imageBase64.startsWith("data:")
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2000,
      messages: [
        { role: "system", content: prompt },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: { url: imageUrl, detail: "low" },
            },
            {
              type: "text",
              text: "Analyze this image and provide the structured output.",
            },
          ],
        },
      ],
    });

    const text = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(text);

    const result: PhotoTaskResult = { mode, data: parsed } as PhotoTaskResult;

    return NextResponse.json({ success: true, result });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
