import type { MiddlewareHandler } from 'hono'
import { getAuth } from '../auth'
import type { Env } from '../env'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Stable per-app slug, prefixed onto every KV key so apps that SHARE a RATE_LIMIT namespace can
 * never cross-pollinate counters (the keys carry no namespace isolation of their own). Derived
 * from APP_CONFIG.name — the one field the mint always rewrites — so it stays config-driven with
 * no extra knob: lowercased, non-alphanumeric runs collapsed to a single '-'. e.g. 'Splitrue' →
 * 'splitrue', 'App Template' → 'app-template'.
 */
const APP_SLUG = APP_CONFIG.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/**
 * Fixed-window rate limiter on Workers KV — an ABUSE CAP, not a precise quota.
 *
 * KV is eventually consistent across edge locations, so concurrent requests can briefly
 * over-count or under-count: a determined attacker hammering multiple colos may squeeze in a few
 * extra requests per window. That is fine for what this protects — the expensive routes (AI,
 * voice, image) where the failure mode is a runaway bill, not a security boundary. Anything
 * needing exact counting belongs in a Durable Object, which the template deliberately avoids
 * until an app opts in.
 *
 * Keying: `rl:<appSlug>:<route>:<userId|ip>:<windowStart>` — the appSlug guards against namespace
 * sharing; signed-in callers are limited per user (stable across devices/IPs), anonymous callers
 * per connecting IP (cf-connecting-ip is set by Cloudflare at the edge and can't be spoofed by the
 * client). Each key expires shortly after its window so KV self-cleans.
 */
export function rateLimit(
  route: string,
  { limit, windowSeconds }: { limit: number; windowSeconds: number },
): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const kv = c.env.RATE_LIMIT
    if (!kv) return next() // binding absent (e.g. stripped-down local dev) — fail open

    // Caller identity: session user when present, else the edge-provided client IP.
    const session = await getAuth(c.env).api.getSession({ headers: c.req.raw.headers })
    const caller = session?.user.id ?? c.req.header('cf-connecting-ip') ?? 'anonymous'

    const nowSeconds = Math.floor(Date.now() / 1000)
    const windowStart = Math.floor(nowSeconds / windowSeconds) * windowSeconds
    const key = `rl:${APP_SLUG}:${route}:${caller}:${windowStart}`

    try {
      const count = Number((await kv.get(key)) ?? '0')
      if (count >= limit) {
        c.header('retry-after', String(windowStart + windowSeconds - nowSeconds))
        return c.json({ error: 'rate limited — try again soon' }, 429)
      }
      // Keep the counter just past its window (KV requires expirationTtl >= 60s).
      await kv.put(key, String(count + 1), { expirationTtl: Math.max(windowSeconds + 60, 60) })
    } catch (e) {
      // KV hiccup — fail OPEN with a log line; a broken limiter must never break the product.
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'rate_limit.kv_error',
          route,
          message: e instanceof Error ? e.message : String(e),
        }),
      )
    }
    return next()
  }
}
