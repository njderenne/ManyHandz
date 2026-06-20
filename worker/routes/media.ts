import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '@/lib/db'
import { requireOrg, type AuthEnv } from '../middleware/org'

/**
 * Media — R2-backed file storage, org-scoped per the notifications.ts reference (session gate →
 * active-org guard → every query filtered by organizationId). Objects live in R2 under
 * `org/<orgId>/<uuid>`; the `media` table is the registry row the app actually works with
 * (mime, size, uploader) — the R2 key never leaves the server.
 *
 * R2 requires one-time dashboard enablement, so the binding is OPTIONAL: until the [[r2_buckets]]
 * block in wrangler.toml is uncommented, every route answers an honest 501 instead of crashing.
 *
 *   POST   /api/media      (multipart: file=<upload>, allow-listed type, ≤25MB) → 201 + media row
 *   GET    /api/media/:id  → streams the object (inline for allow-listed types, download otherwise)
 *   DELETE /api/media/:id  → deletes the R2 object + the row
 */
export const mediaRoutes = new Hono<AuthEnv>()

// The Worker serves the SPA from this same origin, so replaying a client-supplied content-type
// (text/html, image/svg+xml, …) on GET would execute uploaded markup with the victim's session —
// stored XSS. Only these types are accepted at upload AND served inline on download; anything
// else (including legacy rows written before this list existed) is forced to a download.
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  // HEIC/HEIF: the iOS camera's native format. The picker transcodes to JPEG (pickImage/takePhoto
  // use 'Compatible'), so this is defense-in-depth — a stray HEIC stores instead of 400-ing. Safe to
  // serve inline (image, not markup); non-Apple browsers may not render it, but iOS/expo-image does.
  'image/heic',
  'image/heif',
  'video/mp4',
  'video/webm',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/webm',
  'application/pdf',
])

// formData() has already buffered the whole body by the time we can measure it, so this cap is
// about storage abuse (R2 + registry bloat), not Worker memory.
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024

// Without the R2 binding, fail every media route loudly and consistently. The body carries a
// stable, machine-readable `error` code — `media_not_configured` — so the client upload path can
// detect THIS case specifically (vs. a transient 5xx) and surface friendly copy / hide the photo
// button, rather than showing a generic upload failure. Keep the code string in sync with
// MEDIA_NOT_CONFIGURED in src/lib/media/upload.ts.
mediaRoutes.use(async (c, next) => {
  if (!c.env.MEDIA) {
    return c.json(
      { error: 'media_not_configured', message: 'Photo storage is not enabled for this app.' },
      501,
    )
  }
  await next()
})

// Session + active-org gate on every route (media is mounted org-less, so the org comes from the
// session — Better-Auth enforces membership when setting the active org).
mediaRoutes.use(requireOrg)

mediaRoutes.post('/', async (c) => {
  const session = c.get('session')
  const orgId = c.get('orgId')

  const form = await c.req.formData().catch(() => null)
  if (!form) return c.json({ error: 'expected multipart form data' }, 400)
  const file = form.get('file')
  if (!file || typeof file === 'string') {
    return c.json({ error: 'file is required (multipart field: file)' }, 400)
  }

  const mimeType = file.type
  if (!ALLOWED_MIME_TYPES.has(mimeType)) return c.json({ error: 'unsupported file type' }, 400)
  if (file.size > MAX_UPLOAD_BYTES) return c.json({ error: 'file too large (max 25MB)' }, 400)

  // Key is org-prefixed so a bucket listing/cleanup can be org-scoped too.
  const key = `org/${orgId}/${crypto.randomUUID()}`
  // The use() above guarantees MEDIA; TS can't see across the middleware, hence the assertion.
  await c.env.MEDIA!.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: mimeType } })

  const [row] = await getDb(c.env.DATABASE_URL)
    .insert(schema.media)
    .values({
      organizationId: orgId,
      uploaderId: session.user.id,
      key,
      mimeType,
      sizeBytes: file.size,
    })
    .returning()
  return c.json(row, 201)
})

mediaRoutes.get('/:id', async (c) => {
  const orgId = c.get('orgId')

  // Org-guarded lookup — the row id alone is never enough (golden rule 4).
  const [row] = await getDb(c.env.DATABASE_URL)
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, c.req.param('id')), eq(schema.media.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)

  const object = await c.env.MEDIA!.get(row.key)
  if (!object) return c.json({ error: 'object missing from storage' }, 404)

  // Stream straight from R2 — no buffering. Only allow-listed types are served inline; legacy
  // rows with any other stored mime are downgraded to a forced octet-stream download so the
  // browser never interprets them. nosniff stops content-type guessing either way.
  const inline = ALLOWED_MIME_TYPES.has(row.mimeType)
  return new Response(object.body, {
    headers: {
      'content-type': inline ? row.mimeType : 'application/octet-stream',
      'content-disposition': inline ? 'inline' : 'attachment',
      'x-content-type-options': 'nosniff',
      'content-length': String(object.size),
      etag: object.httpEtag,
      'cache-control': 'private, max-age=3600',
    },
  })
})

mediaRoutes.delete('/:id', async (c) => {
  const orgId = c.get('orgId')

  const db = getDb(c.env.DATABASE_URL)
  const [row] = await db
    .select()
    .from(schema.media)
    .where(and(eq(schema.media.id, c.req.param('id')), eq(schema.media.organizationId, orgId)))
    .limit(1)
  if (!row) return c.json({ error: 'not found' }, 404)

  // Object first, then row: if the R2 delete throws we keep the row, so nothing is orphaned
  // invisibly (a dangling row is findable; a dangling object is not).
  await c.env.MEDIA!.delete(row.key)
  await db
    .delete(schema.media)
    .where(and(eq(schema.media.id, row.id), eq(schema.media.organizationId, orgId)))
  return c.json({ ok: true })
})
