// ---------------------------------------------------------------------------
// In-memory rate limiter for API routes
// Uses a sliding window approach. State is lost on restart, which is acceptable
// since it only prevents burst abuse, not sustained attacks.
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  tokens: number;
  lastRefill: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodically clean up expired entries to prevent memory leaks
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanupStale(windowMs: number) {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now - entry.lastRefill > windowMs * 2) {
      store.delete(key);
    }
  }
}

/**
 * Token-bucket rate limiter.
 *
 * @param key       Unique identifier (e.g. `auth:${ip}` or `ai:${userId}`)
 * @param limit     Max tokens (requests) in the window
 * @param windowMs  Window duration in milliseconds
 * @returns         `{ success, remaining, retryAfterMs }`
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { success: boolean; remaining: number; retryAfterMs: number } {
  cleanupStale(windowMs);

  const now = Date.now();
  let entry = store.get(key);

  if (!entry) {
    entry = { tokens: limit, lastRefill: now };
    store.set(key, entry);
  }

  // Refill tokens proportionally to elapsed time
  const elapsed = now - entry.lastRefill;
  const refillRate = limit / windowMs; // tokens per ms
  const tokensToAdd = elapsed * refillRate;
  entry.tokens = Math.min(limit, entry.tokens + tokensToAdd);
  entry.lastRefill = now;

  if (entry.tokens >= 1) {
    entry.tokens -= 1;
    return { success: true, remaining: Math.floor(entry.tokens), retryAfterMs: 0 };
  }

  // Calculate when 1 token will be available
  const msPerToken = windowMs / limit;
  const retryAfterMs = Math.ceil(msPerToken - (elapsed % msPerToken));

  return { success: false, remaining: 0, retryAfterMs };
}

// ---------------------------------------------------------------------------
// Pre-configured rate limit presets for different route categories
// ---------------------------------------------------------------------------

/** Auth endpoints: 10 requests per 15 minutes per IP */
export function rateLimitAuth(ip: string) {
  return rateLimit(`auth:${ip}`, 10, 15 * 60 * 1000);
}

/** Household lookup: 30 requests per hour per IP */
export function rateLimitLookup(ip: string) {
  return rateLimit(`lookup:${ip}`, 30, 60 * 60 * 1000);
}

/** AI endpoints: 20 requests per hour per user */
export function rateLimitAI(userId: string) {
  return rateLimit(`ai:${userId}`, 20, 60 * 60 * 1000);
}

/** Export: 10 requests per hour per user */
export function rateLimitExport(userId: string) {
  return rateLimit(`export:${userId}`, 10, 60 * 60 * 1000);
}

/** General API: 120 requests per minute per user */
export function rateLimitGeneral(userId: string) {
  return rateLimit(`general:${userId}`, 120, 60 * 1000);
}

// ---------------------------------------------------------------------------
// Helper to extract client IP from request headers
// ---------------------------------------------------------------------------

export function getClientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

// ---------------------------------------------------------------------------
// Helper to build a 429 response with standard headers
// ---------------------------------------------------------------------------

import { NextResponse } from "next/server";

export function rateLimitResponse(retryAfterMs: number): NextResponse {
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);
  return NextResponse.json(
    { error: "Too many requests. Please try again later." },
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfterSec),
        "X-RateLimit-Reset": String(retryAfterSec),
      },
    }
  );
}
