import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'
import { requireTier } from '../entitlements'


/**
 * Weekly reports — the read side of the generate-reports cron. The cron (NOT this route) writes one
 * weekly_report row per household per week (per-member grades, MVP, AI suggestions, …); here we only
 * READ them back for the Report Card screen. Org-scoped reads available to every household member;
 * there are no writes (generation is cron-owned). Pairs with src/lib/query/hooks/useReports.ts.
 *
 *   GET /api/organizations/:orgId/reports           → history, last 12, newest first
 *   GET /api/organizations/:orgId/reports/current   → the most recent week (404 if none yet)
 *
 * report_data / ai_suggestions are jsonb — typed loosely (the cron owns their shape).
 */
export const reportRoutes = new Hono<AuthEnv>()

/** How many weeks of history the Report Card screen scrolls through. */
const HISTORY_LIMIT = 12

const historyQuery = z.object({
  limit: z.coerce.number().int().min(1).max(HISTORY_LIMIT).optional(),
})

/** The selection every report endpoint returns — the row plus the MVP member's display name. */
const reportColumns = {
  id: schema.weeklyReport.id,
  organizationId: schema.weeklyReport.organizationId,
  weekStart: schema.weeklyReport.weekStart,
  weekEnd: schema.weeklyReport.weekEnd,
  reportData: schema.weeklyReport.reportData,
  aiSuggestions: schema.weeklyReport.aiSuggestions,
  mvpMemberId: schema.weeklyReport.mvpMemberId,
  mvpMemberName: schema.member.displayName,
  createdAt: schema.weeklyReport.createdAt,
}

reportRoutes.get('/:orgId/reports', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  // Paid: history & insights (the weekly Report Card) is a Premium feature.
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const parsed = historyQuery.safeParse({ limit: c.req.query('limit') })
  if (!parsed.success) return c.json({ error: 'invalid input', issues: parsed.error.issues }, 400)
  const limit = parsed.data.limit ?? HISTORY_LIMIT

  const rows = await getDb(c.env.DATABASE_URL)
    .select(reportColumns)
    .from(schema.weeklyReport)
    .leftJoin(schema.member, eq(schema.member.id, schema.weeklyReport.mvpMemberId))
    .where(eq(schema.weeklyReport.organizationId, orgId))
    .orderBy(desc(schema.weeklyReport.weekStart))
    .limit(limit)
  return c.json(rows)
})

reportRoutes.get('/:orgId/reports/current', requireOrg, async (c) => {
  const orgId = c.get('orgId')
  const gate = await requireTier(getDb(c.env.DATABASE_URL), orgId, 'STANDARD')
  if (!gate.ok) return c.json({ error: gate.reason }, 402)
  const [row] = await getDb(c.env.DATABASE_URL)
    .select(reportColumns)
    .from(schema.weeklyReport)
    .leftJoin(schema.member, eq(schema.member.id, schema.weeklyReport.mvpMemberId))
    .where(eq(schema.weeklyReport.organizationId, orgId))
    .orderBy(desc(schema.weeklyReport.weekStart))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)
  return c.json(row)
})
