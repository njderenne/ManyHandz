import { lt } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import type { Env } from './env'

/**
 * Cron — the `scheduled` export wired up in index.ts and triggered by [triggers] in wrangler.toml
 * (every 6 hours). The template ships only housekeeping that is SAFE on any app:
 *
 *   1. Prune the webhook_event idempotency ledger — providers stop retrying within days, so rows
 *      older than 30 days are dead weight.
 *   2. Prune expired `verification` rows (Better-Auth email-verify / reset tokens past expiresAt).
 *
 * Each step is independently try/caught + structured-logged so one failure never starves the
 * rest. App-specific jobs (reminders, digests) are added below — pattern at the bottom.
 */

const DAY_MS = 24 * 60 * 60 * 1000

export async function scheduled(
  controller: ScheduledController,
  env: Env,
  _ctx: ExecutionContext,
): Promise<void> {
  const db = getDb(env.DATABASE_URL)

  const done = (step: string, extra: Record<string, unknown>) =>
    console.log(JSON.stringify({ level: 'info', event: 'cron.step', cron: controller.cron, step, ...extra }))
  const failed = (step: string, e: unknown) =>
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'cron.step_failed',
        cron: controller.cron,
        step,
        message: e instanceof Error ? e.message : String(e),
        stack: e instanceof Error ? e.stack : undefined,
      }),
    )

  // 1. Webhook idempotency ledger — entries only matter while the provider might still retry.
  try {
    const cutoff = new Date(Date.now() - 30 * DAY_MS)
    const gone = await db
      .delete(schema.webhookEvent)
      .where(lt(schema.webhookEvent.processedAt, cutoff))
      .returning({ id: schema.webhookEvent.id })
    done('webhook_event.prune', { deleted: gone.length })
  } catch (e) {
    failed('webhook_event.prune', e)
  }

  // 2. Expired verification tokens (email verify / password reset) — useless past expiresAt.
  try {
    const gone = await db
      .delete(schema.verification)
      .where(lt(schema.verification.expiresAt, new Date()))
      .returning({ id: schema.verification.id })
    done('verification.prune', { deleted: gone.length })
  } catch (e) {
    failed('verification.prune', e)
  }

  // --- Pattern: an app-specific reminder job (NOT active in the template) ---
  //
  // A minted app with scheduled reminders adds a step here: query the due rows, fan out pushes
  // via Expo's push service exactly like routes/push.ts does, then advance each row's nextDueAt
  // so a crashed run never double-sends more than one window.
  //
  // try {
  //   const due = await db
  //     .select()
  //     .from(schema.reminder)
  //     .where(lte(schema.reminder.nextDueAt, new Date()))
  //     .limit(100) // bound each run; the next tick picks up the rest
  //   for (const reminder of due) {
  //     const tokens = await db
  //       .select()
  //       .from(schema.pushToken)
  //       .where(eq(schema.pushToken.userId, reminder.userId))
  //     if (tokens.length > 0) {
  //       await fetch('https://exp.host/--/api/v2/push/send', {
  //         method: 'POST',
  //         headers: { 'content-type': 'application/json', accept: 'application/json' },
  //         body: JSON.stringify(
  //           tokens.map((t) => ({ to: t.token, title: reminder.title, sound: 'default' })),
  //         ),
  //       })
  //     }
  //     await db
  //       .update(schema.reminder)
  //       .set({ nextDueAt: nextOccurrence(reminder) }) // advance BEFORE the next run can see it
  //       .where(eq(schema.reminder.id, reminder.id))
  //   }
  //   done('reminders.send', { sent: due.length })
  // } catch (e) {
  //   failed('reminders.send', e)
  // }
}
