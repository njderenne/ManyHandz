import { drizzle } from 'drizzle-orm/neon-http'
import { neon } from '@neondatabase/serverless'
import * as schema from './schema'

/**
 * Neon (serverless Postgres) + Drizzle client.
 *
 * Uses the HTTP driver — the right fit for Cloudflare Workers (no long-lived sockets,
 * one round-trip per query). For interactive transactions, swap to `drizzle-orm/neon-serverless`
 * with a Pool. The connection string is a Worker secret (env.DATABASE_URL).
 */
export function createDb(databaseUrl: string) {
  const sql = neon(databaseUrl)
  return drizzle({ client: sql, schema })
}

let cached: { url: string; db: ReturnType<typeof createDb> } | null = null

/** Memoized per-isolate client — the HTTP driver is stateless, so reuse across requests is safe. */
export function getDb(databaseUrl: string) {
  if (!cached || cached.url !== databaseUrl) cached = { url: databaseUrl, db: createDb(databaseUrl) }
  return cached.db
}

export type DB = ReturnType<typeof createDb>
export { schema }
