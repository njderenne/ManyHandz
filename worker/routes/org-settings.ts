import { Hono } from 'hono'
import { eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { ORG_ADDITIONAL_FIELDS } from '@/lib/auth/org-fields'
import { requireOrg, requireCapability, audit, type AuthEnv } from '../middleware/org'

/**
 * Org settings — the capability-gated org-management path (SPINE_SPEC §4.3, B-1).
 *
 * WHY this exists next to Better-Auth's plugin-native update/delete: the plugin's org endpoints
 * key on its LITERAL owner/admin/member roles. A kind with a custom role vocabulary (ManyHandz
 * family orgs have no member Better-Auth recognizes as privileged) would silently 403 on org
 * rename/delete post-cutover. These routes gate on the KIND_CONFIGS capability matrix instead:
 *
 *   PATCH  /api/orgs/settings   requireOrg + requireCapability('org:settings')
 *   DELETE /api/orgs/settings   requireOrg + requireCapability('org:delete')
 *
 * Default-vocabulary apps may keep using plugin-native flows (both paths stay correct there —
 * the default matrix grants org:settings/org:delete to the same owner/admin the plugin honors);
 * custom-vocabulary kinds MUST route org management through these.
 *
 * No :orgId param on purpose — the target is ALWAYS the session's active organization
 * (requireOrg), so a cross-org URL is unrepresentable. Extension fields ride the same PATCH:
 * any key declared in ORG_ADDITIONAL_FIELDS (src/lib/auth/org-fields.ts) is accepted after
 * type-checking — EXCEPT `kind`, which is immutable post-create (changing it would orphan the
 * members' role vocabulary; a kind rename is a migration, SPINE §3.2, never a settings write).
 */
export const orgSettingsRoutes = new Hono<AuthEnv>()

const MAX_NAME = 200
const MAX_TEXT_FIELD = 1000

/** Keys of ORG_ADDITIONAL_FIELDS a PATCH may write (kind is the immutable discriminator). */
const PATCHABLE_EXTENSION_KEYS = Object.keys(ORG_ADDITIONAL_FIELDS).filter((k) => k !== 'kind')

/**
 * Update the active org. Body: `{ name?, logo?, ...extension fields }` — only the keys present
 * change (PATCH semantics). Unknown keys are rejected (a typo'd field name must not silently
 * no-op), and extension values are validated against the declared additionalFields type.
 */
orgSettingsRoutes.patch('/settings', requireOrg, requireCapability('org:settings'), async (c) => {
  const orgId = c.get('orgId')
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return c.json({ error: 'body must be a JSON object' }, 400)
  }

  const fields: Record<string, unknown> = {}

  for (const [key, value] of Object.entries(body)) {
    if (key === 'name') {
      if (typeof value !== 'string' || !value.trim()) return c.json({ error: 'name is required' }, 400)
      if (value.trim().length > MAX_NAME) {
        return c.json({ error: `name must be 1-${MAX_NAME} characters` }, 400)
      }
      fields.name = value.trim()
      continue
    }
    if (key === 'logo') {
      // A URL string or null to clear — the media pipeline owns actual uploads.
      if (value !== null && typeof value !== 'string') {
        return c.json({ error: 'logo must be a string or null' }, 400)
      }
      if (typeof value === 'string' && value.length > 2048) {
        return c.json({ error: 'logo must be at most 2048 characters' }, 400)
      }
      fields.logo = value === '' ? null : value
      continue
    }
    if (key === 'kind') {
      return c.json({ error: 'kind is immutable' }, 400)
    }
    if (PATCHABLE_EXTENSION_KEYS.includes(key)) {
      // Validate against the DECLARED type — the org-fields mirror is the single allowlist, so
      // client, server hook, and this PATCH can never drift (SPINE §3.4).
      const decl = ORG_ADDITIONAL_FIELDS[key as keyof typeof ORG_ADDITIONAL_FIELDS] as { type: string }
      if (value === null) {
        fields[key] = null // extension columns are nullable by convention (SPINE §3.3)
      } else if (decl.type === 'string' && typeof value === 'string') {
        if (value.length > MAX_TEXT_FIELD) {
          return c.json({ error: `${key} must be at most ${MAX_TEXT_FIELD} characters` }, 400)
        }
        fields[key] = value
      } else if (decl.type === 'boolean' && typeof value === 'boolean') {
        fields[key] = value
      } else if (decl.type === 'number' && typeof value === 'number' && Number.isFinite(value)) {
        fields[key] = value
      } else {
        return c.json({ error: `${key} must be a ${decl.type} or null` }, 400)
      }
      // Belt-and-suspenders: the declared field must exist as a schema column, or the update
      // would throw. Catches an org-fields entry added before its migration.
      if (!(key in schema.organization)) {
        return c.json({ error: `${key} is not a writable organization column` }, 400)
      }
      continue
    }
    return c.json({ error: `unknown field '${key}'` }, 400)
  }

  if (Object.keys(fields).length === 0) return c.json({ error: 'nothing to update' }, 400)

  const [row] = await getDb(c.env.DATABASE_URL)
    .update(schema.organization)
    .set(fields as Partial<typeof schema.organization.$inferInsert>)
    .where(eq(schema.organization.id, orgId))
    .returning({
      // Narrow DTO on purpose — billing columns (stripe ids, period ends) have their own
      // surface (/api/billing/summary); a settings write shouldn't echo them.
      id: schema.organization.id,
      name: schema.organization.name,
      slug: schema.organization.slug,
      logo: schema.organization.logo,
      kind: schema.organization.kind,
    })
  if (!row) return c.json({ error: 'organization not found' }, 404)

  await audit(c, {
    entityType: 'organization',
    entityId: orgId,
    action: 'org.settings_updated',
    metadata: { changed: Object.keys(fields) },
  })
  return c.json(row)
})

/**
 * Delete the active org — hard delete; every org-scoped table cascades (schema convention:
 * organization_id FK onDelete:'cascade'). The client flow MUST be useConfirm()-backed (the
 * chassis account/team screens own that UX). audit() runs BEFORE the delete per SPINE §4.3 —
 * note the activity_log row itself cascades away with the org, so the structured console line
 * below is the delete's durable trace (Workers logs outlive the tenant).
 */
orgSettingsRoutes.delete('/settings', requireOrg, requireCapability('org:delete'), async (c) => {
  const orgId = c.get('orgId')
  const session = c.get('session')

  await audit(c, { entityType: 'organization', entityId: orgId, action: 'org.deleted' })
  console.log(
    JSON.stringify({
      level: 'info',
      event: 'org.deleted',
      organizationId: orgId,
      userId: session.user.id,
    }),
  )

  const [deleted] = await getDb(c.env.DATABASE_URL)
    .delete(schema.organization)
    .where(eq(schema.organization.id, orgId))
    .returning({ id: schema.organization.id })
  if (!deleted) return c.json({ error: 'organization not found' }, 404)

  // Sessions still pointing at the deleted org resolve to 403 on their next org route (requireOrg
  // re-verifies membership per request); the client's active-org atom refetches and the context
  // guard / active-org guard route the user to a surviving context.
  return c.json({ ok: true })
})
