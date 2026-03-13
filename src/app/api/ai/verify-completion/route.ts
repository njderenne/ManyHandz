// ============================================================================
// ManyHandz — AI: Verify Completion
// Uses GPT-4o (or Claude) to evaluate before/after photos of a chore
// and determine whether the task was actually completed.
// ============================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { verifyHouseholdMembership } from "@/lib/utils/auth-checks";
import { rateLimitAI, rateLimitResponse } from "@/lib/utils/rate-limit";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

interface VerifyRequest {
  completionId: string;
  beforePhotoUrl: string;
  afterPhotoUrl: string;
  referencePhotoUrl?: string;
  choreName: string;
  choreDescription?: string;
}

/** Completion with joined assignment data (household_id) from Supabase query */
type CompletionWithAssignment = {
  id: string;
  assignments: { household_id: string };
  [key: string]: unknown;
};

interface VerificationResult {
  confidence_score: number;
  task_completed: boolean;
  reference_match_score: number | null;
  reasoning: string;
  before_analysis: string;
  after_analysis: string;
  reference_comparison: string | null;
}

/** Allowed hostname patterns for image fetching (SSRF protection) */
const ALLOWED_IMAGE_HOSTS = [
  /\.supabase\.co$/,
  /\.supabase\.in$/,
];

async function fetchImageAsBase64(url: string): Promise<string> {
  // Photos from the completion modal arrive as data: URLs — return as-is
  if (url.startsWith("data:")) return url;

  // SSRF protection: only allow fetching from known hosts
  try {
    const parsed = new URL(url);
    const isAllowed = ALLOWED_IMAGE_HOSTS.some((pattern) =>
      pattern.test(parsed.hostname)
    );
    if (!isAllowed) {
      throw new Error(`Image host not allowed: ${parsed.hostname}`);
    }
    // Block non-HTTP(S) protocols
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`Protocol not allowed: ${parsed.protocol}`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("Image host")) throw e;
    if (e instanceof Error && e.message.startsWith("Protocol")) throw e;
    throw new Error("Invalid image URL");
  }

  const response = await fetch(url);
  const buffer = await response.arrayBuffer();

  // Limit image size to 10MB
  if (buffer.byteLength > 10 * 1024 * 1024) {
    throw new Error("Image too large (max 10MB)");
  }

  const base64 = Buffer.from(buffer).toString("base64");
  const contentType = response.headers.get("content-type") || "image/jpeg";
  return `data:${contentType};base64,${base64}`;
}

function buildPrompt(
  choreName: string,
  choreDescription?: string,
  hasReference?: boolean
): string {
  return `You are a chore verification AI for a household management app called ManyHandz.

TASK: "${choreName}"${choreDescription ? `\nDescription: "${choreDescription}"` : ""}

You will be shown a BEFORE photo and an AFTER photo of this chore.
${hasReference ? "You will also be shown a REFERENCE photo showing what the completed task should look like." : ""}

Evaluate the photos and respond with ONLY valid JSON (no markdown, no code fences):
{
  "confidence_score": <number 0-100 representing how confident you are in your assessment>,
  "task_completed": <boolean, whether the task appears to have been completed>,
  "reference_match_score": ${hasReference ? "<number 0-100 representing how closely the after photo matches the reference>" : "null"},
  "reasoning": "<2-3 sentence explanation of your assessment>",
  "before_analysis": "<1-2 sentence description of what you see in the before photo>",
  "after_analysis": "<1-2 sentence description of what you see in the after photo>",
  "reference_comparison": ${hasReference ? '"<1-2 sentence comparison between after photo and reference>"' : "null"}
}

Scoring guide:
- 90-100: Clear evidence the task was completed thoroughly
- 70-89: Task appears mostly done, minor issues possible
- 50-69: Uncertain - some evidence of work but inconclusive
- 30-49: Task appears incomplete
- 0-29: No evidence of completion or photos don't match the task`;
}

async function verifyWithOpenAI(
  beforeBase64: string,
  afterBase64: string,
  referenceBase64: string | null,
  choreName: string,
  choreDescription?: string
): Promise<{ result: VerificationResult; model: string; cost_cents: number }> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const prompt = buildPrompt(choreName, choreDescription, !!referenceBase64);

  const images: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [
    { type: "text", text: "BEFORE photo:" },
    {
      type: "image_url",
      image_url: { url: beforeBase64, detail: "low" },
    },
    { type: "text", text: "AFTER photo:" },
    {
      type: "image_url",
      image_url: { url: afterBase64, detail: "low" },
    },
  ];

  if (referenceBase64) {
    images.push(
      { type: "text", text: "REFERENCE photo (ideal completed state):" },
      {
        type: "image_url",
        image_url: { url: referenceBase64, detail: "low" },
      }
    );
  }

  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    max_tokens: 1000,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: images },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const result = JSON.parse(text) as VerificationResult;

  // Estimate cost: ~$2.50/1M input tokens, ~$10/1M output tokens for GPT-4o
  // Each low-detail image is ~85 tokens
  const inputTokens = response.usage?.prompt_tokens ?? 500;
  const outputTokens = response.usage?.completion_tokens ?? 200;
  const cost_cents = Math.round(
    ((inputTokens / 1_000_000) * 250 + (outputTokens / 1_000_000) * 1000) * 100
  ) / 100;

  return { result, model: "gpt-4o", cost_cents };
}

async function verifyWithAnthropic(
  beforeBase64: string,
  afterBase64: string,
  referenceBase64: string | null,
  choreName: string,
  choreDescription?: string
): Promise<{ result: VerificationResult; model: string; cost_cents: number }> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const prompt = buildPrompt(choreName, choreDescription, !!referenceBase64);

  const extractMediaType = (dataUrl: string) => {
    const match = dataUrl.match(/^data:(image\/\w+);base64,/);
    return (match?.[1] ?? "image/jpeg") as
      | "image/jpeg"
      | "image/png"
      | "image/gif"
      | "image/webp";
  };

  const extractData = (dataUrl: string) => {
    return dataUrl.replace(/^data:image\/\w+;base64,/, "");
  };

  const content: Anthropic.Messages.ContentBlockParam[] = [
    { type: "text", text: "BEFORE photo:" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: extractMediaType(beforeBase64),
        data: extractData(beforeBase64),
      },
    },
    { type: "text", text: "AFTER photo:" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: extractMediaType(afterBase64),
        data: extractData(afterBase64),
      },
    },
  ];

  if (referenceBase64) {
    content.push(
      { type: "text", text: "REFERENCE photo (ideal completed state):" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: extractMediaType(referenceBase64),
          data: extractData(referenceBase64),
        },
      }
    );
  }

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: prompt,
    messages: [{ role: "user", content }],
  });

  const text =
    response.content[0]?.type === "text" ? response.content[0].text : "{}";
  const result = JSON.parse(text) as VerificationResult;

  // Estimate cost: ~$3/1M input tokens, ~$15/1M output tokens for Sonnet
  const inputTokens = response.usage?.input_tokens ?? 500;
  const outputTokens = response.usage?.output_tokens ?? 200;
  const cost_cents = Math.round(
    ((inputTokens / 1_000_000) * 300 + (outputTokens / 1_000_000) * 1500) * 100
  ) / 100;

  return { result, model: "claude-sonnet-4-20250514", cost_cents };
}

export async function POST(request: Request) {
  try {
    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = rateLimitAI(user.id);
    if (!rl.success) return rateLimitResponse(rl.retryAfterMs);

    const body = (await request.json()) as VerifyRequest;
    const {
      completionId,
      beforePhotoUrl,
      afterPhotoUrl,
      referencePhotoUrl,
      choreName,
      choreDescription,
    } = body;

    if (!completionId || !beforePhotoUrl || !afterPhotoUrl || !choreName) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const serviceClient = createServiceClient();

    // Get the completion to find the household
    const { data: completion } = await serviceClient
      .from("completions")
      .select("*, assignments!inner(household_id)")
      .eq("id", completionId)
      .single();

    if (!completion) {
      return NextResponse.json(
        { error: "Completion not found" },
        { status: 404 }
      );
    }

    const householdId = (completion as unknown as CompletionWithAssignment).assignments.household_id;

    // Verify user is an active member of this household
    const member = await verifyHouseholdMembership(supabase, user.id, householdId);
    if (!member) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get household AI settings
    const { data: household } = await serviceClient
      .from("households")
      .select(
        "ai_verification_enabled, ai_verification_provider, ai_auto_approve_threshold, ai_auto_reject_threshold, ai_monthly_cost_cap_cents"
      )
      .eq("id", householdId)
      .single();

    if (!household?.ai_verification_enabled) {
      return NextResponse.json(
        { error: "AI verification not enabled for this household" },
        { status: 400 }
      );
    }

    // Check monthly cost cap
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

    if (totalCostCents >= household.ai_monthly_cost_cap_cents) {
      return NextResponse.json(
        { error: "Monthly AI cost cap reached" },
        { status: 429 }
      );
    }

    // Fetch images as base64
    const [beforeBase64, afterBase64] = await Promise.all([
      fetchImageAsBase64(beforePhotoUrl),
      fetchImageAsBase64(afterPhotoUrl),
    ]);

    let referenceBase64: string | null = null;
    if (referencePhotoUrl) {
      referenceBase64 = await fetchImageAsBase64(referencePhotoUrl);
    }

    // Run AI verification
    const provider = household.ai_verification_provider ?? "openai";
    const verifyFn =
      provider === "anthropic" ? verifyWithAnthropic : verifyWithOpenAI;

    const { result, model, cost_cents } = await verifyFn(
      beforeBase64,
      afterBase64,
      referenceBase64,
      choreName,
      choreDescription
    );

    // Determine decision based on thresholds
    const approveThreshold = household.ai_auto_approve_threshold ?? 80;
    const rejectThreshold = household.ai_auto_reject_threshold ?? 30;
    let decision: "auto_approved" | "flagged_for_review" | "auto_rejected";

    if (result.confidence_score >= approveThreshold && result.task_completed) {
      decision = "auto_approved";
    } else if (
      result.confidence_score < rejectThreshold ||
      (!result.task_completed && result.confidence_score < 50)
    ) {
      decision = "auto_rejected";
    } else {
      decision = "flagged_for_review";
    }

    // Save to ai_verifications table
    const { data: verification, error: insertError } = await serviceClient
      .from("ai_verifications")
      .insert({
        completion_id: completionId,
        provider,
        model,
        confidence_score: result.confidence_score,
        reference_match_score: result.reference_match_score,
        reasoning: result.reasoning,
        reference_comparison: result.reference_comparison,
        decision,
        before_analysis: result.before_analysis,
        after_analysis: result.after_analysis,
        raw_response: result as unknown as Record<string, unknown>,
        cost_cents: Math.round(cost_cents),
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Update completion status and link verification
    const completionStatus =
      decision === "auto_approved"
        ? "ai_approved"
        : decision === "auto_rejected"
        ? "rejected"
        : "pending_approval";

    await serviceClient
      .from("completions")
      .update({
        ai_verification_id: verification.id,
        status: completionStatus,
        ...(decision === "auto_rejected"
          ? { rejection_reason: `AI: ${result.reasoning}` }
          : {}),
      })
      .eq("id", completionId);

    // If auto-approved, also update the assignment
    if (decision === "auto_approved") {
      await serviceClient
        .from("assignments")
        .update({ status: "completed" })
        .eq("id", completion.assignment_id);
    }

    return NextResponse.json({
      success: true,
      verification: {
        id: verification.id,
        confidence_score: result.confidence_score,
        task_completed: result.task_completed,
        reference_match_score: result.reference_match_score,
        reasoning: result.reasoning,
        before_analysis: result.before_analysis,
        after_analysis: result.after_analysis,
        reference_comparison: result.reference_comparison,
        decision,
        provider,
        model,
        cost_cents: Math.round(cost_cents),
      },
    });
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
