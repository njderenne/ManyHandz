// ============================================================================
// ManyHandz — AI: Parse Shared Text
// Accepts text shared via the Web Share API and parses it into
// shopping items, quick tasks, or chore assignments using GPT-4o.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rateLimitAI, rateLimitResponse } from "@/lib/utils/rate-limit";
import OpenAI from "openai";

interface ParseRequest {
  text: string;
  title?: string;
  url?: string;
}

export interface ParsedShoppingItem {
  name: string;
  quantity: string | null;
  category:
    | "produce"
    | "dairy"
    | "meat"
    | "bakery"
    | "frozen"
    | "pantry"
    | "beverages"
    | "snacks"
    | "cleaning"
    | "household"
    | "personal"
    | "pets"
    | "other";
  note: string | null;
}

export interface ParsedQuickTask {
  title: string;
  note: string | null;
  due_date: string | null;
}

export interface ParsedChore {
  name: string;
  description: string | null;
  difficulty: number;
  estimated_minutes: number;
  category: string;
}

export interface ParseResult {
  type: "shopping" | "tasks" | "chore" | "mixed";
  shopping_items: ParsedShoppingItem[];
  quick_tasks: ParsedQuickTask[];
  chores: ParsedChore[];
  raw_text: string;
}

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

    const body = (await request.json()) as ParseRequest;
    const { text, title, url } = body;

    if (!text && !title) {
      return NextResponse.json(
        { error: "text or title required" },
        { status: 400 }
      );
    }

    // Limit input size to prevent AI cost abuse (10KB max)
    const MAX_INPUT_LENGTH = 10_000;
    const combinedLength =
      (text?.length ?? 0) + (title?.length ?? 0) + (url?.length ?? 0);
    if (combinedLength > MAX_INPUT_LENGTH) {
      return NextResponse.json(
        { error: `Input too large (max ${MAX_INPUT_LENGTH} characters)` },
        { status: 400 }
      );
    }

    const fullText = [title, text, url].filter(Boolean).join("\n\n");

    const prompt = `You are an AI assistant for ManyHandz, a household management app. Parse the following shared text into actionable items.

SHARED CONTENT:
"""
${fullText}
"""

Analyze the content and categorize items into these types:
1. SHOPPING ITEMS - things to buy (groceries, supplies, etc.)
2. QUICK TASKS - one-off tasks to do (not recurring chores)
3. CHORES - recurring or significant household tasks

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "type": "<shopping|tasks|chore|mixed>",
  "shopping_items": [
    {
      "name": "<item name>",
      "quantity": "<quantity or null>",
      "category": "<produce|dairy|meat|bakery|frozen|pantry|beverages|snacks|cleaning|household|personal|pets|other>",
      "note": "<any extra note or null>"
    }
  ],
  "quick_tasks": [
    {
      "title": "<task title>",
      "note": "<details or null>",
      "due_date": "<YYYY-MM-DD or null>"
    }
  ],
  "chores": [
    {
      "name": "<chore name>",
      "description": "<description or null>",
      "difficulty": <1-5>,
      "estimated_minutes": <number>,
      "category": "<Kitchen|Bathroom|Living Areas|Bedroom|Outdoor|Laundry|Pets|General>"
    }
  ]
}

Rules:
- Only include arrays that have actual items. Empty arrays are fine.
- Set "type" based on what the majority of items are, or "mixed" if roughly equal.
- For shopping items, infer the category from the item name.
- For tasks, try to extract due dates if mentioned.
- For chores, estimate difficulty (1=easy, 5=expert) and time.
- Be practical — don't over-split or over-combine items.`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    });

    const responseText = response.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(responseText) as Omit<ParseResult, "raw_text">;

    const result: ParseResult = {
      ...parsed,
      shopping_items: parsed.shopping_items ?? [],
      quick_tasks: parsed.quick_tasks ?? [],
      chores: parsed.chores ?? [],
      raw_text: fullText,
    };

    return NextResponse.json({ success: true, result });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
