import { relations, sql } from 'drizzle-orm'
import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  boolean,
  jsonb,
  integer,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from 'drizzle-orm/pg-core'

/**
 * Drizzle schema — the baseline multi-tenant chassis.
 *
 * Tenancy: the `organization`/`member`/`invitation` tables are owned by Better-Auth's
 * organization plugin (orgs, roles, invites, active-org switching). Display-aliased per app via
 * APP_CONFIG.tenant. Tenant isolation is enforced by app-layer authorization — every query is
 * org/user-scoped through the worker's query layer, never the database (see APPFACTORY_STACK.md §6).
 *
 * Auth tables (user/session/account/verification/passkey) follow Better-Auth's shape so its
 * Drizzle adapter can own them. Property keys are camelCase (Better-Auth field names); DB
 * columns are snake_case.
 */

export const subscriptionTierEnum = pgEnum('subscription_tier', ['FREE', 'STANDARD', 'PREMIUM'])
export const subscriptionStatusEnum = pgEnum('subscription_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
  'unpaid',
])

// --- Identity (Better-Auth) ---

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  // Set by the organization plugin when a member switches active org.
  activeOrganizationId: text('active_organization_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const account = pgTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const passkey = pgTable('passkey', {
  id: text('id').primaryKey(),
  name: text('name'),
  publicKey: text('public_key').notNull(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  credentialID: text('credential_id').notNull(),
  counter: integer('counter').notNull(),
  deviceType: text('device_type').notNull(),
  backedUp: boolean('backed_up').notNull(),
  transports: text('transports'),
  aaguid: text('aaguid'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

// --- Tenant (Better-Auth organization plugin) ---

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'),
  /** Tenant flavor — SPINE §10.3 cutover: ManyHandz kinds are 'family' | 'roommate' | 'office'
   *  (+ reserved 'personal', unused here — no autoPersonalOrg). MUST equal DEFAULT_KIND in
   *  src/lib/config/roles.ts (a vitest asserts it). The legacy `mode` column below carries the
   *  same value until release N+1 drops it. */
  kind: text('kind').notNull().default('family'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
  // Billing — managed by Stripe webhooks via Drizzle (not Better-Auth). Phase 5.
  subscriptionTier: subscriptionTierEnum('subscription_tier').notNull().default('FREE'),
  subscriptionStatus: subscriptionStatusEnum('subscription_status'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
  currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
  // --- ManyHandz: household config + policy flags (Settings screen + POLICY_FLAGS read these). ---
  /** DEPRECATED (SPINE §10.3 release N): superseded by `kind` above — kept dual-written until the
   *  release N+1 migration drops it. Do not add new readers. */
  mode: text('mode').notNull().default('family'), // 'family' | 'roommate' | 'office'
  inviteCode: text('invite_code').unique(), // 8-char join-by-code / QR code (minted on create)
  timezone: text('timezone').notNull().default('America/New_York'),
  requirePhotoProof: boolean('require_photo_proof').notNull().default(false),
  requireApproval: boolean('require_approval').notNull().default(true),
  leaderboardVisible: boolean('leaderboard_visible').notNull().default(true),
  // Two-layer kid gating — the mode matrix grants the base; these are authoritative at runtime
  // (see canWithHousehold in modes.ts).
  allowKidGifting: boolean('allow_kid_gifting').notNull().default(true),
  allowKidChallenges: boolean('allow_kid_challenges').notNull().default(false),
  allowKidCompetitions: boolean('allow_kid_competitions').notNull().default(true),
  maxKidCompetitionStakes: integer('max_kid_competition_stakes').notNull().default(50),
  // AI photo-verification policy (per-household; each chore also opts in individually).
  aiVerificationEnabled: boolean('ai_verification_enabled').notNull().default(false),
  aiVerificationProvider: text('ai_verification_provider').notNull().default('openai'),
  aiAutoApproveThreshold: integer('ai_auto_approve_threshold').notNull().default(85),
  aiAutoRejectThreshold: integer('ai_auto_reject_threshold').notNull().default(40),
  aiMonthlyCostCapCents: integer('ai_monthly_cost_cap_cents').notNull().default(500),
  healthScore: integer('health_score').notNull().default(100),
})

export const member = pgTable(
  'member',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('member'),
    /** Optional per-member display name within this org (falls back to user.name). */
    displayName: text('display_name'),
    // --- ManyHandz: per-household identity. `householdRole` (parent|kid|roommate|manager|colleague)
    //     drives the mode permission matrix; points/XP/streaks are DERIVED from creditLedger +
    //     streak, never stored here (the Gains "derive at query time" lesson). ---
    householdRole: text('household_role').notNull().default('roommate'),
    avatarUrl: text('avatar_url'),
    bio: text('bio'),
    birthday: text('birthday'), // YYYY-MM-DD; age computed in the app
    favoriteColor: text('favorite_color').notNull().default('coral'), // accent palette KEY, not a hex
    isActive: boolean('is_active').notNull().default(true),
    awayUntil: text('away_until'), // YYYY-MM-DD; while away: rotation skips + excluded from fairness
    awayReason: text('away_reason'),
    muteCelebrations: boolean('mute_celebrations').notNull().default(false),
    // Allowance (family) — the weekly cron auto-creates a settlement when a kid meets the threshold.
    allowanceEnabled: boolean('allowance_enabled').notNull().default(false),
    allowancePayoutType: text('allowance_payout_type').notNull().default('money'),
    allowanceAmountCents: integer('allowance_amount_cents').notNull().default(0),
    allowanceRewardDescription: text('allowance_reward_description'),
    allowanceThresholdPct: integer('allowance_threshold_pct').notNull().default(80),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Soft-archive: an archived member keeps history but is excluded from rosters, pickers,
     *  and oversight reads (worker/middleware/org.ts requireOrg filters on it). NULL = active. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
  },
  (t) => [index('member_org_idx').on(t.organizationId), index('member_user_idx').on(t.userId)],
)

export const invitation = pgTable(
  'invitation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role'),
    status: text('status').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    inviterId: text('inviter_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [
    index('invitation_org_idx').on(t.organizationId),
    index('invitation_email_idx').on(t.email),
  ],
)

// --- Cross-cutting: notifications + audit log (present on every app) ---

export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    /** Deep-link target — the row this notification is about (same convention as activity_log). */
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    isRead: boolean('is_read').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.isRead)],
)

// Expo push tokens — one row per device. The Worker sends pushes via Expo's push service
// (exp.host); tokens are upserted on registration and owned by the session user.
export const pushToken = pgTable(
  'push_token',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    token: text('token').notNull().unique(),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('push_token_user_idx').on(t.userId)],
)

export const activityLog = pgTable(
  'activity_log',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id'),
    action: text('action').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activity_org_idx').on(t.organizationId, t.createdAt)],
)

// --- Relations ---

export const userRelations = relations(user, ({ many }) => ({
  memberships: many(member),
  notifications: many(notification),
  pushTokens: many(pushToken),
}))

export const pushTokenRelations = relations(pushToken, ({ one }) => ({
  user: one(user, { fields: [pushToken.userId], references: [user.id] }),
}))

export const organizationRelations = relations(organization, ({ many }) => ({
  members: many(member),
  invitations: many(invitation),
  notifications: many(notification),
  activity: many(activityLog),
}))

export const memberRelations = relations(member, ({ one }) => ({
  organization: one(organization, {
    fields: [member.organizationId],
    references: [organization.id],
  }),
  user: one(user, { fields: [member.userId], references: [user.id] }),
}))

export const invitationRelations = relations(invitation, ({ one }) => ({
  organization: one(organization, {
    fields: [invitation.organizationId],
    references: [organization.id],
  }),
  inviter: one(user, { fields: [invitation.inviterId], references: [user.id] }),
}))

// --- Standard plumbing: present on every app (see builder/MINT.md §5 conventions) ---

/**
 * Server-side user settings — what the SERVER must know about a user (timezone for scheduled
 * reminders, locale, onboarding state, marketing consent). Device-local taste (haptics, theme)
 * stays in the client prefs store; per-app extras go in `extra`.
 */
export const userSettings = pgTable('user_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id')
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: 'cascade' }),
  timezone: text('timezone'), // IANA, e.g. 'America/Chicago'
  locale: text('locale'), // BCP-47, e.g. 'en-US'
  marketingOptIn: boolean('marketing_opt_in').notNull().default(false),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }),
  /** Idempotency stamp — the lifecycle welcome email fires exactly once per account. */
  welcomeEmailSentAt: timestamp('welcome_email_sent_at', { withTimezone: true }),
  /** Per-category notification opt-ins, e.g. { reminders: 'weekly', digest: false }. */
  notificationPrefs: jsonb('notification_prefs').$type<Record<string, unknown>>(),
  extra: jsonb('extra').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
})

/** File registry for R2-backed uploads — one row per stored object (the key is the R2 object key). */
export const media = pgTable(
  'media',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    uploaderId: text('uploader_id').references(() => user.id, { onDelete: 'set null' }),
    key: text('key').notNull().unique(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    alt: text('alt'),
    /** Optional user-facing file name (document vaults) — distinct from the opaque R2 key. */
    name: text('name'),
    /** Per-app category, e.g. 'receipt' | 'document' | 'progress_photo'. */
    kind: text('kind'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('media_org_idx').on(t.organizationId, t.createdAt)],
)

/**
 * Processed external webhook events — the idempotency ledger. Providers (Stripe, RevenueCat)
 * RETRY deliveries; insert (provider, eventId) with onConflictDoNothing and skip the event when
 * the insert returns no row. Without this, a retried billing event can double-apply.
 */
export const webhookEvent = pgTable(
  'webhook_event',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    provider: text('provider').notNull(), // 'stripe' | 'revenuecat' | …
    eventId: text('event_id').notNull(),
    type: text('type'),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('webhook_event_provider_event_idx').on(t.provider, t.eventId)],
)

/** In-app feedback / support requests — every shipped app needs a feedback channel on day one. */
export const feedback = pgTable(
  'feedback',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    category: text('category'), // 'bug' | 'idea' | 'other' | per-app
    message: text('message').notNull(),
    appVersion: text('app_version'),
    platform: text('platform'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('feedback_created_idx').on(t.createdAt)],
)

/** Referral codes — the server side of lib/referrals (codes are meaningless without redemption). */
export const referral = pgTable(
  'referral',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    code: text('code').notNull().unique(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    redeemedByUserId: text('redeemed_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('referral_owner_idx').on(t.ownerUserId),
    // Race-proof backstops for the redeem route's check-then-act (no transactions on the HTTP
    // driver): a user can redeem at most ONE code ever, and hold at most ONE open code at a time.
    // The route maps 23505 violations onto its friendly 400s; these indexes are the source of truth.
    uniqueIndex('referral_redeemer_once_idx')
      .on(t.redeemedByUserId)
      .where(sql`${t.redeemedByUserId} is not null`),
    uniqueIndex('referral_one_open_per_owner_idx')
      .on(t.ownerUserId)
      .where(sql`${t.redeemedAt} is null`),
  ],
)

export const userSettingsRelations = relations(userSettings, ({ one }) => ({
  user: one(user, { fields: [userSettings.userId], references: [user.id] }),
}))

export const mediaRelations = relations(media, ({ one }) => ({
  organization: one(organization, { fields: [media.organizationId], references: [organization.id] }),
  uploader: one(user, { fields: [media.uploaderId], references: [user.id] }),
}))

// --- Standard modules: AI, sharing, integrations, moderation, billing, engagement ---
// Validated across minted apps (Gains, Splitrue) — product tables reference these, never
// re-create them per app. Vocabulary columns (kind/feature/provider/reason) are TEXT, not enums,
// so apps extend them without a migration.

/**
 * API cost ledger — ONE row per billable external API call (AI, email, SMS, voice, image, …), so spend
 * is trackable by app FUNCTION (`feature`), by `provider`, and by `operation` (model/endpoint), with the
 * cost ESTIMATED at log time (worker/usage/pricing.ts). Generalizes the old ai_usage_log: AI calls record
 * token counts; other providers record their own units (emails, characters, images, seconds). TEXT keys
 * → new features/providers need no migration. Powers per-app/per-feature spend dashboards + tier quotas.
 *
 * `cost_micro_usd` is MICRO-dollars (millionths of a USD) so sub-cent AI calls keep precision: 500 = $0.0005.
 */
export const apiUsage = pgTable(
  'api_usage',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'set null' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** The PAID provider — 'openai' | 'anthropic' | 'xai' | 'resend' | 'elevenlabs' | 'replicate' | 'twilio' | … */
    provider: text('provider').notNull(),
    /** The app FUNCTION that spent the money — 'chore.verify' | 'ai.complete' | 'ai.chat' | 'email.invite' | 'voice.tts' | … */
    feature: text('feature').notNull(),
    /** The specific model/endpoint billed — 'gpt-4o-mini' | 'grok-4.3' | 'claude-opus-4-8' | 'send' | … */
    operation: text('operation'),
    /** Usage quantities; meaning per unitKind. AI: tokens in/out. Others: input_units carries the count. */
    inputUnits: integer('input_units'),
    outputUnits: integer('output_units'),
    /** What input/output_units COUNT — 'tokens' | 'characters' | 'images' | 'seconds' | 'emails' | 'requests'. */
    unitKind: text('unit_kind'),
    /** Estimated cost in MICRO-USD (millionths of a dollar). Null when no rate is configured for this op. */
    costMicroUsd: integer('cost_micro_usd'),
    ok: boolean('ok').notNull().default(true),
    /** Stable failure code when !ok — 'rate_limit' | 'quota_exceeded' | 'provider_error' | 'timeout' | 'invalid_input'. */
    errorCode: text('error_code'),
    latencyMs: integer('latency_ms'),
    /** Freeform extras (request ids, sub-feature, retries) — never PII. */
    meta: jsonb('meta').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('api_usage_org_idx').on(t.organizationId, t.createdAt),
    index('api_usage_feature_idx').on(t.feature, t.createdAt),
    index('api_usage_provider_idx').on(t.provider, t.createdAt),
  ],
)

/** AI chat threads — multi-turn assistant conversations. Per-user (private by default); orgId is context, not access. */
export const aiChatThread = pgTable(
  'ai_chat_thread',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    /** Usually the first user message clipped to ~50 chars; null until the first turn lands. */
    title: text('title'),
    /** Bumped on every new message so the thread list sorts by recency for free. */
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_chat_thread_user_idx').on(t.userId, t.lastMessageAt)],
)

/** AI chat messages — the system message is persisted too, so a thread replays exactly. */
export const aiChatMessage = pgTable(
  'ai_chat_message',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    threadId: text('thread_id')
      .notNull()
      .references(() => aiChatThread.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // 'system' | 'user' | 'assistant'
    content: text('content').notNull(),
    // Usage + provenance — set on assistant messages only (the user may switch models mid-thread).
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    provider: text('provider'),
    model: text('model'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_chat_message_thread_idx').on(t.threadId, t.createdAt)],
)

/**
 * Public share-link tokens — a random token exposes ONE entity (or a feed, e.g. an iCal URL)
 * read-only without auth, with expiry/revoke/view-count. entityType+entityId instead of hard FKs
 * so one table serves every shareable thing. Resolve server-side and return a minimal payload —
 * never leak the owning row or user identity.
 */
export const shareToken = pgTable(
  'share_token',
  {
    token: text('token').primaryKey(), // mint server-side: crypto.randomUUID() or longer
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(), // 'workout_session' | 'calendar_feed' | per-app
    entityId: text('entity_id'), // null for feed-type tokens
    /** Optional public display name ("Alex") — shares are anonymous by default. */
    displayName: text('display_name'),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // null = never
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    viewCount: integer('view_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('share_token_user_idx').on(t.userId),
    index('share_token_entity_idx').on(t.entityType, t.entityId),
  ],
)

/**
 * Third-party OAuth/API tokens (wearables, calendars, …) — per-user, because OAuth grants are
 * between a person and a service. `ciphertext` is a token-cipher envelope
 * (src/lib/crypto/token-cipher.ts, AAD = userId) — NEVER store raw token JSON.
 */
export const providerToken = pgTable(
  'provider_token',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'fitbit' | 'strava' | 'google_calendar' | per-app
    ciphertext: text('ciphertext').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }), // access-token expiry; refresh before this
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** Set on disconnect; keep the row briefly so a reconnect can reuse the refresh token. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('provider_token_user_provider_idx').on(t.userId, t.provider)],
)

/** Incremental-sync checkpoint per (user, provider) — health bridges, calendar/mail sync, …. */
export const syncState = pgTable(
  'sync_state',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // 'apple_health' | 'health_connect' | per-app
    enabled: boolean('enabled').notNull().default(false),
    lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
    /** The provider's incremental cursor (HealthKit anchor, page token, …). */
    cursor: text('cursor'),
    scopes: jsonb('scopes').$type<string[]>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('sync_state_user_provider_idx').on(t.userId, t.provider)],
)

/**
 * UGC abuse reports — App Store Guideline 1.2 REQUIRES report + block in any app surfacing
 * user-generated content. Target is polymorphic: an entity (post/comment/media/…) and/or a user
 * (profile/behavior reports). FKs go null when the target is deleted; the audit trail survives.
 */
export const report = pgTable(
  'report',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'set null' }),
    reporterUserId: text('reporter_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    reportedUserId: text('reported_user_id').references(() => user.id, { onDelete: 'set null' }),
    /** 'spam' | 'harassment' | 'inappropriate' | 'other' — matches REPORT_REASONS in worker/routes/moderation.ts. */
    reason: text('reason').notNull(),
    details: text('details'),
    status: text('status').notNull().default('open'), // 'open' | 'reviewed' | 'actioned' | 'dismissed'
    reviewerUserId: text('reviewer_user_id').references(() => user.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    actionTaken: text('action_taken'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('report_status_idx').on(t.status, t.createdAt),
    check('report_has_target', sql`${t.entityId} IS NOT NULL OR ${t.reportedUserId} IS NOT NULL`),
  ],
)

/** User blocks — filter blocked users' UGC in queries/hooks (not in SQL policies; see Gains 057 notes). */
export const userBlock = pgTable(
  'user_block',
  {
    blockerUserId: text('blocker_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    blockedUserId: text('blocked_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerUserId, t.blockedUserId] }),
    check('user_block_not_self', sql`${t.blockerUserId} <> ${t.blockedUserId}`),
  ],
)

/**
 * Per-provider subscription truth — one row per Stripe subscription / Apple original transaction /
 * Google purchase token. Webhooks and store server notifications write HERE; a resolver collapses
 * the rows onto the organization's billing columns (the entitlement CACHE the app reads).
 * Exists because Apple/Google purchases belong to a USER while entitlements are per-ORG
 * (decision #9) — and a tenant can hold a Stripe sub (web) and an IAP sub (device) at once.
 */
export const subscription = pgTable(
  'subscription',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Who made the purchase — store receipts belong to a person (their Apple/Google account). */
    purchaserUserId: text('purchaser_user_id').references(() => user.id, { onDelete: 'set null' }),
    provider: text('provider').notNull(), // 'stripe' | 'apple' | 'google'
    /** Stripe price ID / App Store product ID / Play SKU. */
    productId: text('product_id').notNull(),
    tier: subscriptionTierEnum('tier').notNull(),
    status: subscriptionStatusEnum('status').notNull(),
    /** Stripe subscription id / Apple original_transaction_id / Google purchase token. */
    externalId: text('external_id').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    trialEndsAt: timestamp('trial_ends_at', { withTimezone: true }),
    canceledAt: timestamp('canceled_at', { withTimezone: true }),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('subscription_provider_external_idx').on(t.provider, t.externalId),
    index('subscription_org_idx').on(t.organizationId),
  ],
)

/**
 * Credits/points — APPEND-ONLY ledger; balance = SUM(delta) per (org, user, kind). Never store a
 * mutable balance (that's how apps double-credit). Integer units: points, or cents for
 * money-like credits. kind: 'reward_points' | 'referral_credit' | 'promo' | per-app.
 */
export const creditLedger = pgTable(
  'credit_ledger',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Null = org-wide credit. set null on account deletion so historic sums hold. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(),
    delta: integer('delta').notNull(), // signed: positive = earn, negative = spend
    reason: text('reason'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** Set for credits from external/retryable events — the unique constraint blocks double-credit. */
    idempotencyKey: text('idempotency_key').unique(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('credit_ledger_scope_idx').on(t.organizationId, t.userId, t.kind, t.createdAt)],
)

/** Achievement unlocks — definitions live in code/config; only the unlocks are data (createdAt = unlock time). */
export const achievementUnlock = pgTable(
  'achievement_unlock',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    achievementKey: text('achievement_key').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(), // e.g. the value that triggered it
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('achievement_unlock_unique_idx').on(t.organizationId, t.userId, t.achievementKey),
  ],
)

/**
 * Bookmarks/favorites — the universal "save this" primitive. Polymorphic via entityType+entityId
 * (same convention as notification/report), so ANY domain row is bookmarkable without new tables.
 * kind distinguishes flavors when an app has more than one ('favorite' default; 'pin', 'watchlist').
 */
export const bookmark = pgTable(
  'bookmark',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    kind: text('kind').notNull().default('favorite'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('bookmark_unique_idx').on(t.organizationId, t.userId, t.entityType, t.entityId, t.kind),
    index('bookmark_scope_idx').on(t.organizationId, t.userId, t.kind, t.createdAt),
  ],
)

/**
 * Streaks — consecutive-day engagement counters, one row per (org, user, kind). Day boundaries
 * use lastActivityDate as a YYYY-MM-DD string in the USER'S timezone (user_settings.timezone),
 * so clock math never breaks streaks across midnights/DST. "Broken" is computed on READ
 * (lastActivityDate < yesterday), not by a cron — rows never need a reset job.
 * kind: 'daily' default; per-app vocab ('workout', 'practice', …).
 */
export const streak = pgTable(
  'streak',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull().default('daily'),
    currentCount: integer('current_count').notNull().default(0),
    longestCount: integer('longest_count').notNull().default(0),
    /** YYYY-MM-DD in the user's timezone at the time of the activity. */
    lastActivityDate: text('last_activity_date'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('streak_scope_unique_idx').on(t.organizationId, t.userId, t.kind)],
)

/**
 * Generic org-scoped calendar — appointments, scheduled workouts, custody days, …. kind/status
 * vocabularies are per-app; entityType+entityId links an event to the domain row it's about.
 * All-day events: allDay=true with startsAt at UTC midnight (render via user_settings.timezone).
 */
export const calendarEvent = pgTable(
  'calendar_event',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description'),
    kind: text('kind'), // per-app: 'appointment' | 'workout' | 'custody' | …
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    allDay: boolean('all_day').notNull().default(false),
    location: text('location'),
    /** Per-app lifecycle, e.g. 'planned' | 'completed' | 'skipped' | 'canceled'. */
    status: text('status'),
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('calendar_event_org_time_idx').on(t.organizationId, t.startsAt)],
)

/**
 * Member-to-member messaging — IMMUTABLE rows (no updatedAt; ship no edit/delete routes). That's
 * required for court-ready/audit messaging and a good default everywhere. threadId partitions
 * channels ('default' = the org's main channel). Read state lives in message_cursor — one row per
 * reader per thread — never per-message flags (those only work for two-member tenants).
 */
export const message = pgTable(
  'message',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull().default('default'),
    /** set null — the record survives the sender's account deletion. */
    senderId: text('sender_id').references(() => user.id, { onDelete: 'set null' }),
    content: text('content').notNull(),
    /** Optional attachment — a registry row in media. */
    mediaId: text('media_id').references(() => media.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('message_org_thread_idx').on(t.organizationId, t.threadId, t.createdAt)],
)

/** Per-reader read cursor — "unread" = messages newer than lastReadAt in that thread. */
export const messageCursor = pgTable(
  'message_cursor',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    threadId: text('thread_id').notNull().default('default'),
    lastReadAt: timestamp('last_read_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('message_cursor_unique_idx').on(t.organizationId, t.userId, t.threadId)],
)

/** P2P payment handles (pairs with APP_CONFIG.features.peerPayments) — '@venmo', '$cashapp', …. */
export const paymentHandle = pgTable(
  'payment_handle',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    method: text('method').notNull(), // 'venmo' | 'cashapp' | 'paypal' | per-app
    handle: text('handle').notNull(),
    isPreferred: boolean('is_preferred').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('payment_handle_user_method_idx').on(t.userId, t.method)],
)

// ═══════════════════════════════════════════════════════════════════════════════════════════
// 2026-07-05 harvest — Subject primitive, share grants, escalations, engines
// ═══════════════════════════════════════════════════════════════════════════════════════════

/**
 * Subject — the org-scoped "who/what this org tracks" primitive: care recipient, pet, child,
 * athlete, plant… A subject MAY be account-less (selfUserId null) or self-linked to a member's
 * user. "Is self" is DERIVED: subject.selfUserId === session.user.id — never an isSelf column.
 * Subjects are domain rows inside the tenant, never tenants themselves. Apps may ADD real
 * columns after the chassis block (pet-pilot-style) or use `profile` for low-churn extras.
 * PRIVACY: subjects are often minors/patients. Rows never leave org-scoped responses except
 * through an explicit allowlisted DTO (share-grant composers, public resolvers).
 */
export const subject = pgTable(
  'subject',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Per-app vocab from APP_CONFIG.subjects.kinds — 'person' | 'pet' | 'child' | … (TEXT, no enum). */
    kind: text('kind').notNull().default('person'),
    displayName: text('display_name').notNull(),
    /** The self-link — null = account-less subject managed by others. Only ever set to the CALLER's id. */
    selfUserId: text('self_user_id').references(() => user.id, { onDelete: 'set null' }),
    avatarMediaId: text('avatar_media_id').references(() => media.id, { onDelete: 'set null' }),
    /** IANA tz — drives subject-local scheduling (account-less subjects have no user_settings). */
    timezone: text('timezone'),
    /** YYYY-MM-DD TEXT (RxMndr convention — no tz math on a birthday). Nullable: keepsey "expecting". */
    birthDate: text('birth_date'),
    notes: text('notes'),
    /** Escape hatch for per-app low-churn fields (journey pack, species detail…). Never public. */
    profile: jsonb('profile').$type<Record<string, unknown>>(),
    /** Soft-remove — keeps all history, drops from active views, stops schedules/reminders. */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index('subject_org_idx').on(t.organizationId, t.kind),
    index('subject_self_user_idx').on(t.selfUserId),
    // One self-linked subject per (org, user) — a user is at most one "self" per tenant.
    uniqueIndex('subject_org_self_unique_idx')
      .on(t.organizationId, t.selfUserId)
      .where(sql`self_user_id IS NOT NULL`),
  ],
)

export type Subject = typeof subject.$inferSelect
export type NewSubject = typeof subject.$inferInsert

/**
 * Access grant — a NAMED, permission-scoped, time-boxed, auditable capability for an account-less
 * outsider (sitter, visiting nurse, grandparent). The CODE is the credential: short, unambiguous,
 * CSPRNG-minted, re-validated on every request. Soft-revoke preserves the audit trail.
 * Generalizes pet-pilot sitter_access + RxMndr's public-link lifecycle; share_token is UNTOUCHED
 * (anonymous read-only links) — decision matrix in SUBJECT_SPEC §6.
 */
export const accessGrant = pgTable(
  'access_grant',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Optional pin to ONE subject (visiting nurse for Mom). Null = whole-org grant (sitter mode). */
    subjectId: text('subject_id').references(() => subject.id, { onDelete: 'cascade' }),
    granteeName: text('grantee_name').notNull(),
    granteeEmail: text('grantee_email'),
    code: text('code').notNull().unique(),
    /** Per-app scope vocab (worker/grant-config.ts GRANT_SCOPES), e.g. 'view:subjects' | 'log:feeding'. */
    scopes: text('scopes').array().notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(), // NOT NULL — no forever grants
    /** Soft-revoke — null = active. The audit trail is retained after revoke. */
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    useCount: integer('use_count').notNull().default(0),
    createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index('access_grant_org_idx').on(t.organizationId),
    index('access_grant_expires_idx').on(t.expiresAt),
    index('access_grant_subject_idx').on(t.subjectId),
  ],
)

/** Immutable audit of every grant interaction, including 'view' page loads. Bounded per grant
 *  (GRANT_ACTIVITY_MAX_ROWS in worker/lib/access-grant.ts — amortized prune, no cron). */
export const accessGrantActivity = pgTable(
  'access_grant_activity',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    grantId: text('grant_id').notNull()
      .references(() => accessGrant.id, { onDelete: 'cascade' }),
    /** Attribution survives subject purge — SET NULL, not cascade. */
    subjectId: text('subject_id').references(() => subject.id, { onDelete: 'set null' }),
    /** 'view' | an app action verb (matches the scope's action part). */
    action: text('action').notNull(),
    /** Link to the operational row the action created ('feed_log', id) — tamper-evident pairing. */
    entityType: text('entity_type'),
    entityId: text('entity_id'),
    /** WHITELISTED + per-field-capped at the route (untrusted, account-less input). */
    details: jsonb('details').$type<Record<string, unknown>>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('access_grant_activity_grant_idx').on(t.grantId, t.createdAt),
    index('access_grant_activity_org_idx').on(t.organizationId, t.createdAt),
  ],
)

/**
 * Escalation — one row per escalated slot (reminder → follow_up → alert → missed), generalized
 * from RxMndr's production ladder. The slot anchor is (entityType, entityId, scheduledFor) — an
 * app points it at any domain row (medication schedule, chore, dose). Stage vocabulary + dwell
 * timers live in APP_CONFIG.safety.escalation (TEXT column, no enum — RxMndr's pgEnums are the
 * grandfathered exception, never copied). Cron sweep + advance: worker/lib/escalation.ts.
 */
export const escalation = pgTable(
  'escalation',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Optional subject pin — escalations about a person/pet. Null = org-level. */
    subjectId: text('subject_id').references(() => subject.id, { onDelete: 'cascade' }),
    /** App-domain anchor of the escalated slot. */
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }).notNull(),
    /** Current ladder stage — APP_CONFIG.safety.escalation.stages vocab (TEXT). */
    currentStage: text('current_stage').notNull().default('reminder'),
    /** stage → ISO timestamp of entry; drives dwell math + audit. */
    stageTimestamps: jsonb('stage_timestamps').$type<Record<string, string>>().notNull().default({}),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    smsSentAt: timestamp('sms_sent_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** 'confirmed' | 'dismissed' | 'missed' | 'auto' (TEXT vocab). */
    resolution: text('resolution'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    // Idempotent slot creation — the sweep can re-run forever without duplicating a ladder.
    uniqueIndex('escalation_slot_idx').on(t.organizationId, t.entityType, t.entityId, t.scheduledFor),
    index('escalation_unresolved_idx').on(t.currentStage).where(sql`resolved_at IS NULL`),
    index('escalation_subject_idx').on(t.subjectId),
  ],
)

/**
 * Prompt-engine rotation state (keepsey pattern, subject-generalized). Prompt DEFINITIONS live in
 * code (worker/engines/nudge.ts catalog — the achievements doctrine); only rotation state is data.
 * subjectId null = an org-level prompt track (apps without subjects).
 */
export const promptState = pgTable(
  'prompt_state',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id').references(() => subject.id, { onDelete: 'cascade' }),
    servedPromptKeys: jsonb('served_prompt_keys').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    /** 'daily' | 'weekly' | 'off' — user-set cadence; gentle by default, never guilt. */
    cadence: text('cadence').notNull().default('weekly'),
    packKeys: jsonb('pack_keys').$type<string[]>().notNull().default(sql`'["core"]'::jsonb`),
    lastServedAt: timestamp('last_served_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('prompt_state_subject_idx')
      .on(t.organizationId, t.subjectId).where(sql`subject_id IS NOT NULL`),
    uniqueIndex('prompt_state_org_idx')
      .on(t.organizationId).where(sql`subject_id IS NULL`),
  ],
)

/**
 * Seeded reference catalog (grindline drills pattern, generalized). GLOBAL seeded rows have
 * organizationId NULL and a STABLE human id (e.g. 'basketball.shooting.form-shots') written by
 * worker/engines/catalog-seed.ts (idempotent, version-watermarked). Org rows are user customs.
 * Apps with richer needs keep their own tables and reuse the seed MECHANISM only.
 */
export const catalogItem = pgTable(
  'catalog_item',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /** NULL = global seeded row (readable by every org); non-null = that org's custom row. */
    organizationId: text('organization_id')
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** App vocab: 'drill' | 'exercise' | 'recipe' … (TEXT). */
    kind: text('kind').notNull(),
    /** Optional hierarchy (category id within the same table). */
    parentId: text('parent_id'),
    name: text('name').notNull(),
    /** App-shaped payload (instructions, difficulty, media keys…). */
    data: jsonb('data').$type<Record<string, unknown>>(),
    /** Seed-catalog version that last wrote this row (global rows only). */
    version: integer('version').notNull().default(1),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index('catalog_item_kind_idx').on(t.kind, t.parentId),
    index('catalog_item_org_idx').on(t.organizationId),
  ],
)

/**
 * Generated report — range-metrics report with editable AI prose (RxMndr doctor-report pattern).
 * `data` is the deterministic engine output (worker/engines/range-metrics.ts); `summary` is
 * AI/user prose, null until written — the deterministic half never blocks on a model call.
 */
export const generatedReport = pgTable(
  'generated_report',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectId: text('subject_id').references(() => subject.id, { onDelete: 'set null' }),
    /** App vocab: 'doctor-visit' | 'monthly' | … (TEXT). */
    kind: text('kind').notNull(),
    rangeStart: timestamp('range_start', { withTimezone: true }).notNull(),
    rangeEnd: timestamp('range_end', { withTimezone: true }).notNull(),
    /** Deterministic metrics payload — allowlisted DTO shape, engine-computed. */
    data: jsonb('data').$type<Record<string, unknown>>().notNull(),
    /** Editable prose (AI pass or human). Null on generate; capped at the route (≤ 8 KB). */
    summary: text('summary'),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    index('generated_report_org_idx').on(t.organizationId, t.createdAt),
    index('generated_report_subject_idx').on(t.subjectId),
  ],
)

export const aiChatThreadRelations = relations(aiChatThread, ({ one, many }) => ({
  user: one(user, { fields: [aiChatThread.userId], references: [user.id] }),
  messages: many(aiChatMessage),
}))

export const aiChatMessageRelations = relations(aiChatMessage, ({ one }) => ({
  thread: one(aiChatThread, { fields: [aiChatMessage.threadId], references: [aiChatThread.id] }),
}))

export const subscriptionRelations = relations(subscription, ({ one }) => ({
  organization: one(organization, {
    fields: [subscription.organizationId],
    references: [organization.id],
  }),
}))

export const calendarEventRelations = relations(calendarEvent, ({ one }) => ({
  organization: one(organization, {
    fields: [calendarEvent.organizationId],
    references: [organization.id],
  }),
}))

export const messageRelations = relations(message, ({ one }) => ({
  organization: one(organization, { fields: [message.organizationId], references: [organization.id] }),
  sender: one(user, { fields: [message.senderId], references: [user.id] }),
  attachment: one(media, { fields: [message.mediaId], references: [media.id] }),
}))

// ============================================================================
// ManyHandz product schema — the core loop: categories → chores → rotation →
// assignments → completions. All org-scoped (organization = household).
// status/role/type columns are TEXT (extend without a migration). Points/XP/
// streaks DERIVE from creditLedger + streak; completion.pointsEarned is a
// denormalized record kept for fairness scoring + display.
// ============================================================================

/** Chore categories — 8 defaults seeded per household on creation, plus custom ones. */
export const choreCategory = pgTable(
  'chore_category',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon').notNull().default('home'),
    color: text('color').notNull().default('slate'), // accent palette KEY, not a hex
    isDefault: boolean('is_default').notNull().default(false),
    displayOrder: integer('display_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('chore_category_org_idx').on(t.organizationId)],
)

/** Chore — the reusable template/definition (the "what"). Soft-deleted via isActive. */
export const chore = pgTable(
  'chore',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    categoryId: text('category_id').references(() => choreCategory.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    difficulty: integer('difficulty').notNull().default(3), // 1-5
    estimatedMinutes: integer('estimated_minutes').notNull().default(15),
    icon: text('icon').notNull().default('sparkles'),
    /** Gold-standard reference photo ("The Goal"); R2 media row. */
    referencePhotoMediaId: text('reference_photo_media_id').references(() => media.id, { onDelete: 'set null' }),
    /** Text rubric of "what done looks like", derived ONCE from the reference photo (describeReference)
     *  so verification judges against text instead of re-sending the reference image each check. */
    referenceRubric: text('reference_rubric'),
    aiVerificationEnabled: boolean('ai_verification_enabled').notNull().default(false),
    requiresApproval: boolean('requires_approval').notNull().default(true),
    /** Ordered checklist steps. */
    checklist: jsonb('checklist').$type<{ label: string; required: boolean }[]>().notNull().default(sql`'[]'::jsonb`),
    isActive: boolean('is_active').notNull().default(true), // soft delete
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('chore_org_idx').on(t.organizationId, t.isActive)],
)

/** Rotation group — auto-rotates one chore among an ordered set of members at a frequency. */
export const rotationGroup = pgTable(
  'rotation_group',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    choreId: text('chore_id')
      .notNull()
      .references(() => chore.id, { onDelete: 'cascade' }),
    /** Ordered member ids. */
    memberOrder: jsonb('member_order').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    currentIndex: integer('current_index').notNull().default(0),
    rotationType: text('rotation_type').notNull().default('round_robin'), // round_robin | fixed
    frequency: text('frequency').notNull().default('weekly'), // daily | weekly | biweekly | monthly
    startDate: text('start_date').notNull(), // YYYY-MM-DD
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('rotation_group_org_idx').on(t.organizationId, t.isActive)],
)

/** Assignment — a dated instance of a chore tied to one member. The core unit of work. */
export const assignment = pgTable(
  'assignment',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    choreId: text('chore_id')
      .notNull()
      .references(() => chore.id, { onDelete: 'cascade' }),
    assignedToMemberId: text('assigned_to_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    rotationGroupId: text('rotation_group_id').references(() => rotationGroup.id, { onDelete: 'set null' }),
    dueDate: text('due_date').notNull(), // YYYY-MM-DD
    dueTime: text('due_time'), // HH:MM
    originalDueDate: text('original_due_date'), // preserved across snoozes
    snoozeCount: integer('snooze_count').notNull().default(0),
    /** Per-step progress snapshot, aligned to the chore's checklist at assignment time. */
    checklistProgress: jsonb('checklist_progress').$type<{ label: string; done: boolean }[]>().notNull().default(sql`'[]'::jsonb`),
    // pending | in_progress | completed | overdue | skipped | pending_review | snoozed_pending_approval
    status: text('status').notNull().default('pending'),
    skipReason: text('skip_reason'),
    /** Optional "before" photo, captured WHEN THE CHORE IS STARTED (photo-proof flow). The "after"
     *  photo is captured at completion and lives on the completion row; this pairs with it. */
    beforePhotoMediaId: text('before_photo_media_id').references(() => media.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('assignment_org_status_idx').on(t.organizationId, t.status),
    index('assignment_assignee_idx').on(t.assignedToMemberId, t.dueDate),
    index('assignment_org_due_idx').on(t.organizationId, t.dueDate),
  ],
)

/**
 * Completion — the event recording an assignment was done. The Worker computes points on insert
 * (one canonical engine, server-authoritative) and writes a creditLedger entry for the balance;
 * pointsEarned/speedBonus here are the denormalized record used by fairness + display. Approval
 * gates points: a pending_approval completion writes NO ledger entry until approved (brief §11).
 */
export const completion = pgTable(
  'completion',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id')
      .notNull()
      .references(() => assignment.id, { onDelete: 'cascade' }),
    completedByMemberId: text('completed_by_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    completedAt: timestamp('completed_at', { withTimezone: true }).notNull().defaultNow(),
    beforePhotoMediaId: text('before_photo_media_id').references(() => media.id, { onDelete: 'set null' }),
    afterPhotoMediaId: text('after_photo_media_id').references(() => media.id, { onDelete: 'set null' }),
    notes: text('notes'),
    pointsEarned: integer('points_earned').notNull().default(0),
    speedBonus: integer('speed_bonus').notNull().default(0),
    actualMinutes: integer('actual_minutes'),
    approvedByMemberId: text('approved_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    rejectionReason: text('rejection_reason'),
    needsApproval: boolean('needs_approval').notNull().default(false),
    // pending_approval | approved | rejected | ai_approved
    status: text('status').notNull().default('approved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('completion_assignment_idx').on(t.assignmentId),
    index('completion_member_idx').on(t.completedByMemberId, t.status),
    index('completion_org_idx').on(t.organizationId, t.createdAt),
  ],
)

export const choreCategoryRelations = relations(choreCategory, ({ one, many }) => ({
  organization: one(organization, { fields: [choreCategory.organizationId], references: [organization.id] }),
  chores: many(chore),
}))

export const choreRelations = relations(chore, ({ one, many }) => ({
  organization: one(organization, { fields: [chore.organizationId], references: [organization.id] }),
  category: one(choreCategory, { fields: [chore.categoryId], references: [choreCategory.id] }),
  assignments: many(assignment),
}))

export const rotationGroupRelations = relations(rotationGroup, ({ one }) => ({
  organization: one(organization, { fields: [rotationGroup.organizationId], references: [organization.id] }),
  chore: one(chore, { fields: [rotationGroup.choreId], references: [chore.id] }),
}))

export const assignmentRelations = relations(assignment, ({ one, many }) => ({
  organization: one(organization, { fields: [assignment.organizationId], references: [organization.id] }),
  chore: one(chore, { fields: [assignment.choreId], references: [chore.id] }),
  assignedTo: one(member, { fields: [assignment.assignedToMemberId], references: [member.id] }),
  completions: many(completion),
}))

export const completionRelations = relations(completion, ({ one }) => ({
  organization: one(organization, { fields: [completion.organizationId], references: [organization.id] }),
  assignment: one(assignment, { fields: [completion.assignmentId], references: [assignment.id] }),
  completedBy: one(member, { fields: [completion.completedByMemberId], references: [member.id] }),
}))

// ============================================================================
// ManyHandz product schema — the breadth. All org-scoped (organization =
// household). status/type/kind columns are TEXT (extend without a migration).
// Member FKs: the subject member cascades; secondary actor/creator refs set
// null to keep the record. Points spend/earn flow through creditLedger (never
// a stored balance); these tables hold the domain rows the engines act on.
// ============================================================================

// --- Rewards & goals (family gamification) ---

export const reward = pgTable(
  'reward',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('gift'),
    pointsCost: integer('points_cost').notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index('reward_org_idx').on(t.organizationId, t.isActive), check('reward_cost_positive', sql`${t.pointsCost} > 0`)],
)

export const rewardRedemption = pgTable(
  'reward_redemption',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    rewardId: text('reward_id').notNull().references(() => reward.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    pointsSpent: integer('points_spent').notNull(),
    status: text('status').notNull().default('pending'), // pending | approved | rejected
    approvedByMemberId: text('approved_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    redeemedAt: timestamp('redeemed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('reward_redemption_org_idx').on(t.organizationId, t.status), index('reward_redemption_member_idx').on(t.memberId)],
)

export const goal = pgTable(
  'goal',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    icon: text('icon').notNull().default('target'),
    targetPoints: integer('target_points').notNull(),
    currentPoints: integer('current_points').notNull().default(0),
    monetaryValueCents: integer('monetary_value_cents'),
    autoContributeEnabled: boolean('auto_contribute_enabled').notNull().default(false),
    autoContributePercentage: integer('auto_contribute_percentage').notNull().default(25),
    status: text('status').notNull().default('active'), // active | completed | canceled | pending_approval
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index('goal_org_idx').on(t.organizationId, t.status), index('goal_member_idx').on(t.memberId), check('goal_target_positive', sql`${t.targetPoints} > 0`)],
)

export const goalContribution = pgTable(
  'goal_contribution',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    goalId: text('goal_id').notNull().references(() => goal.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    points: integer('points').notNull(),
    source: text('source').notNull().default('manual'), // chore_completion | bonus | manual | transfer
    sourceId: text('source_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('goal_contribution_goal_idx').on(t.goalId), check('goal_contribution_positive', sql`${t.points} > 0`)],
)

// --- Badges & milestones (system badges use achievement_unlock; these are the household-defined set) ---

export const customBadge = pgTable(
  'custom_badge',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull(),
    icon: text('icon').notNull().default('award'),
    color: text('color').notNull().default('amber'), // accent palette KEY, not a hex
    criteriaType: text('criteria_type').notNull(), // manual | chore_count | category_count | streak | speed_bonus_count | points_total
    criteriaTarget: integer('criteria_target'),
    criteriaCategoryId: text('criteria_category_id').references(() => choreCategory.id, { onDelete: 'set null' }),
    isActive: boolean('is_active').notNull().default(true),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('custom_badge_org_idx').on(t.organizationId, t.isActive)],
)

export const customBadgeAward = pgTable(
  'custom_badge_award',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    badgeId: text('badge_id').notNull().references(() => customBadge.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    awardedByMemberId: text('awarded_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    awardedAt: timestamp('awarded_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('custom_badge_award_unique_idx').on(t.badgeId, t.memberId)],
)

export const householdMilestone = pgTable(
  'household_milestone',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    milestoneKey: text('milestone_key').notNull(),
    earnedAt: timestamp('earned_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('household_milestone_unique_idx').on(t.organizationId, t.milestoneKey)],
)

// --- Challenges & competitions ---

export const bonusChallenge = pgTable(
  'bonus_challenge',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    description: text('description'),
    challengeType: text('challenge_type').notNull(), // double_points | complete_count | no_overdue | custom
    targetValue: integer('target_value'),
    bonusPoints: integer('bonus_points').notNull().default(0),
    pointsMultiplier: integer('points_multiplier_x10').notNull().default(10), // ×10 fixed-point: 15 = 1.5×
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    status: text('status').notNull().default('active'), // active | completed | failed | expired
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('bonus_challenge_org_idx').on(t.organizationId, t.status)],
)

export const competition = pgTable(
  'competition',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    challengerMemberId: text('challenger_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    opponentMemberId: text('opponent_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    competitionType: text('competition_type').notNull(), // most_points | most_completions | first_to_target | specific_chore_race
    targetValue: integer('target_value'),
    choreId: text('chore_id').references(() => chore.id, { onDelete: 'set null' }),
    stakesPoints: integer('stakes_points').notNull().default(0),
    stakesDescription: text('stakes_description'),
    challengerProgress: integer('challenger_progress').notNull().default(0),
    opponentProgress: integer('opponent_progress').notNull().default(0),
    status: text('status').notNull().default('pending'), // pending | active | completed | declined | expired
    winnerMemberId: text('winner_member_id').references(() => member.id, { onDelete: 'set null' }),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('competition_org_idx').on(t.organizationId, t.status)],
)

export const pointGift = pgTable(
  'point_gift',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    fromMemberId: text('from_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    toMemberId: text('to_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    points: integer('points').notNull(),
    note: text('note'),
    giftType: text('gift_type').notNull().default('general'), // general | birthday | thank_you | bonus
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('point_gift_org_idx').on(t.organizationId, t.createdAt), check('point_gift_positive', sql`${t.points} > 0`)],
)

// --- Settle-Up ledger (money AND non-money obligations) ---

export const settlement = pgTable(
  'settlement',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    fromMemberId: text('from_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }), // who OWES
    toMemberId: text('to_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }), // who is OWED
    payoutType: text('payout_type').notNull().default('money'), // money | treat | gift | privilege | experience | custom
    amountCents: integer('amount_cents'), // only for payout_type = money
    payoutDescription: text('payout_description'),
    description: text('description').notNull(),
    sourceType: text('source_type').notNull(), // goal_payout | competition | reward_redemption | allowance | manual
    sourceId: text('source_id'),
    status: text('status').notNull().default('pending'), // pending | settled | forgiven | declined
    settledAt: timestamp('settled_at', { withTimezone: true }),
    settledVia: text('settled_via'), // venmo | paypal | cashapp | apple_cash | cash | in_person | other
    settledNote: text('settled_note'),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('settlement_org_idx').on(t.organizationId, t.status)],
)

// --- Shopping lists ---

export const shoppingList = pgTable(
  'shopping_list',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull().default('Groceries'),
    icon: text('icon').notNull().default('shopping-cart'),
    sortOrder: integer('sort_order').notNull().default(0),
    isArchived: boolean('is_archived').notNull().default(false),
    /** Auto-add staple rules: [{item, category, frequencyDays, lastAdded}]. */
    recurringItems: jsonb('recurring_items').$type<{ item: string; category?: string; frequencyDays: number; lastAdded?: string }[]>().notNull().default(sql`'[]'::jsonb`),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shopping_list_org_idx').on(t.organizationId, t.isArchived)],
)

export const shoppingItem = pgTable(
  'shopping_item',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    listId: text('list_id').notNull().references(() => shoppingList.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    quantity: text('quantity'),
    category: text('category'), // produce | dairy | meat | ... | other
    note: text('note'),
    isChecked: boolean('is_checked').notNull().default(false),
    checkedByMemberId: text('checked_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    assignedToMemberId: text('assigned_to_member_id').references(() => member.id, { onDelete: 'set null' }),
    addedByMemberId: text('added_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('shopping_item_list_idx').on(t.listId, t.isChecked)],
)

export const quickTask = pgTable(
  'quick_task',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    note: text('note'),
    assignedToMemberId: text('assigned_to_member_id').references(() => member.id, { onDelete: 'set null' }),
    dueDate: text('due_date'), // YYYY-MM-DD
    dueTime: text('due_time'),
    isCompleted: boolean('is_completed').notNull().default(false),
    completedByMemberId: text('completed_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quick_task_org_idx').on(t.organizationId, t.isCompleted)],
)

// --- Collaboration: comments, polls (normalized votes), announcements ---

export const assignmentComment = pgTable(
  'assignment_comment',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id').notNull().references(() => assignment.id, { onDelete: 'cascade' }),
    memberId: text('member_id').references(() => member.id, { onDelete: 'set null' }),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('assignment_comment_idx').on(t.assignmentId, t.createdAt)],
)

export const householdPoll = pgTable(
  'household_poll',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    question: text('question').notNull(),
    /** [{id, text}] — 2–6 options. */
    options: jsonb('options').$type<{ id: string; text: string }[]>().notNull().default(sql`'[]'::jsonb`),
    allowMultiple: boolean('allow_multiple').notNull().default(false),
    isAnonymous: boolean('is_anonymous').notNull().default(false),
    closesAt: timestamp('closes_at', { withTimezone: true }),
    isClosed: boolean('is_closed').notNull().default(false),
    createdByMemberId: text('created_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('household_poll_org_idx').on(t.organizationId, t.isClosed)],
)

/** Normalized poll votes (the brief's "normalize votes into a table" fix — not a JSON blob). */
export const pollVote = pgTable(
  'poll_vote',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    pollId: text('poll_id').notNull().references(() => householdPoll.id, { onDelete: 'cascade' }),
    optionId: text('option_id').notNull(),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('poll_vote_unique_idx').on(t.pollId, t.memberId, t.optionId), index('poll_vote_poll_idx').on(t.pollId)],
)

export const announcement = pgTable(
  'announcement',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    authorMemberId: text('author_member_id').references(() => member.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body'),
    priority: text('priority').notNull().default('normal'), // normal | important | urgent
    pinned: boolean('pinned').notNull().default(true),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('announcement_org_idx').on(t.organizationId, t.pinned)],
)

// --- Assignment workflow extras: snooze + swap ---

export const snoozeRequest = pgTable(
  'snooze_request',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id').notNull().references(() => assignment.id, { onDelete: 'cascade' }),
    requestedByMemberId: text('requested_by_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    reason: text('reason').notNull(),
    newDueDate: text('new_due_date').notNull(),
    newDueTime: text('new_due_time'),
    status: text('status').notNull().default('pending'), // pending | approved | denied
    reviewedByMemberId: text('reviewed_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    denialReason: text('denial_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('snooze_request_assignment_idx').on(t.assignmentId), index('snooze_request_org_idx').on(t.organizationId, t.status)],
)

export const swapRequest = pgTable(
  'swap_request',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    requesterAssignmentId: text('requester_assignment_id').notNull().references(() => assignment.id, { onDelete: 'cascade' }),
    targetAssignmentId: text('target_assignment_id').references(() => assignment.id, { onDelete: 'cascade' }),
    requesterMemberId: text('requester_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    targetMemberId: text('target_member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    message: text('message'),
    status: text('status').notNull().default('pending'), // pending | accepted | declined | expired
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
  },
  (t) => [index('swap_request_org_idx').on(t.organizationId, t.status)],
)

// --- AI verification + weekly reports + meal planning + activity reactions ---

export const aiVerification = pgTable(
  'ai_verification',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    completionId: text('completion_id').notNull().references(() => completion.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('openai'),
    model: text('model').notNull(),
    confidenceScore: integer('confidence_score').notNull(), // 0-100
    referenceMatchScore: integer('reference_match_score'), // 0-100
    reasoning: text('reasoning').notNull(),
    referenceComparison: text('reference_comparison'),
    decision: text('decision').notNull(), // auto_approved | flagged_for_review | auto_rejected
    beforeAnalysis: text('before_analysis'),
    afterAnalysis: text('after_analysis'),
    rawResponse: jsonb('raw_response').$type<Record<string, unknown>>(),
    costCents: integer('cost_cents'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ai_verification_completion_idx').on(t.completionId), index('ai_verification_org_idx').on(t.organizationId, t.createdAt)],
)

export const weeklyReport = pgTable(
  'weekly_report',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    weekStart: text('week_start').notNull(), // YYYY-MM-DD (Monday)
    weekEnd: text('week_end').notNull(),
    reportData: jsonb('report_data').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    aiSuggestions: jsonb('ai_suggestions').$type<unknown[]>(),
    mvpMemberId: text('mvp_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('weekly_report_unique_idx').on(t.organizationId, t.weekStart)],
)

/** Meal planning (promoted feature) — one entry per date+meal; grocery generation reads these. */
export const mealPlanEntry = pgTable(
  'meal_plan_entry',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    date: text('date').notNull(), // YYYY-MM-DD
    mealType: text('meal_type').notNull(), // breakfast | lunch | dinner | snack
    title: text('title').notNull(),
    notes: text('notes'),
    recipeUrl: text('recipe_url'),
    /** Ingredients to push to a shopping list: [{name, quantity?, category?}]. */
    ingredients: jsonb('ingredients').$type<{ name: string; quantity?: string; category?: string }[]>().notNull().default(sql`'[]'::jsonb`),
    addedByMemberId: text('added_by_member_id').references(() => member.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [index('meal_plan_entry_org_date_idx').on(t.organizationId, t.date)],
)

/** Normalized activity-feed reactions (the brief's fix — not a last-write-wins JSON blob). The feed
 *  itself is the org-scoped activity_log; a reaction targets one log row. */
export const activityReaction = pgTable(
  'activity_reaction',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
    activityId: text('activity_id').notNull().references(() => activityLog.id, { onDelete: 'cascade' }),
    memberId: text('member_id').notNull().references(() => member.id, { onDelete: 'cascade' }),
    emoji: text('emoji').notNull(), // 👍 ❤️ 🔥 ⭐ 👏
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('activity_reaction_unique_idx').on(t.activityId, t.memberId, t.emoji)],
)

// --- Inferred types (single source of truth for the app) ---

export type User = typeof user.$inferSelect
export type Session = typeof session.$inferSelect
export type Organization = typeof organization.$inferSelect
export type Member = typeof member.$inferSelect
export type Invitation = typeof invitation.$inferSelect
export type Notification = typeof notification.$inferSelect
export type PushToken = typeof pushToken.$inferSelect
export type ActivityLogEntry = typeof activityLog.$inferSelect
export type UserSettings = typeof userSettings.$inferSelect
export type Media = typeof media.$inferSelect
export type WebhookEvent = typeof webhookEvent.$inferSelect
export type Feedback = typeof feedback.$inferSelect
export type Referral = typeof referral.$inferSelect
export type ApiUsageEntry = typeof apiUsage.$inferSelect
export type AiChatThread = typeof aiChatThread.$inferSelect
export type AiChatMessage = typeof aiChatMessage.$inferSelect
export type ShareToken = typeof shareToken.$inferSelect
export type ProviderToken = typeof providerToken.$inferSelect
export type SyncState = typeof syncState.$inferSelect
export type Report = typeof report.$inferSelect
export type UserBlock = typeof userBlock.$inferSelect
export type Subscription = typeof subscription.$inferSelect
export type CreditLedgerEntry = typeof creditLedger.$inferSelect
export type AchievementUnlock = typeof achievementUnlock.$inferSelect
export type Streak = typeof streak.$inferSelect
export type Bookmark = typeof bookmark.$inferSelect
export type CalendarEvent = typeof calendarEvent.$inferSelect
export type Message = typeof message.$inferSelect
export type MessageCursor = typeof messageCursor.$inferSelect
export type PaymentHandle = typeof paymentHandle.$inferSelect

// ManyHandz product types
export type ChoreCategory = typeof choreCategory.$inferSelect
export type Chore = typeof chore.$inferSelect
export type RotationGroup = typeof rotationGroup.$inferSelect
export type Assignment = typeof assignment.$inferSelect
export type Completion = typeof completion.$inferSelect
export type Reward = typeof reward.$inferSelect
export type RewardRedemption = typeof rewardRedemption.$inferSelect
export type Goal = typeof goal.$inferSelect
export type GoalContribution = typeof goalContribution.$inferSelect
export type CustomBadge = typeof customBadge.$inferSelect
export type CustomBadgeAward = typeof customBadgeAward.$inferSelect
export type HouseholdMilestone = typeof householdMilestone.$inferSelect
export type BonusChallenge = typeof bonusChallenge.$inferSelect
export type Competition = typeof competition.$inferSelect
export type PointGift = typeof pointGift.$inferSelect
export type Settlement = typeof settlement.$inferSelect
export type ShoppingList = typeof shoppingList.$inferSelect
export type ShoppingItem = typeof shoppingItem.$inferSelect
export type QuickTask = typeof quickTask.$inferSelect
export type AssignmentComment = typeof assignmentComment.$inferSelect
export type HouseholdPoll = typeof householdPoll.$inferSelect
export type PollVote = typeof pollVote.$inferSelect
export type Announcement = typeof announcement.$inferSelect
export type SnoozeRequest = typeof snoozeRequest.$inferSelect
export type SwapRequest = typeof swapRequest.$inferSelect
export type AiVerification = typeof aiVerification.$inferSelect
export type WeeklyReport = typeof weeklyReport.$inferSelect
export type MealPlanEntry = typeof mealPlanEntry.$inferSelect
export type ActivityReaction = typeof activityReaction.$inferSelect
// 2026-07-05 harvest tables (Subject/NewSubject are exported beside the table — SUBJECT_SPEC shape).
export type AccessGrant = typeof accessGrant.$inferSelect
export type AccessGrantActivity = typeof accessGrantActivity.$inferSelect
export type Escalation = typeof escalation.$inferSelect
export type PromptState = typeof promptState.$inferSelect
export type CatalogItem = typeof catalogItem.$inferSelect
export type GeneratedReport = typeof generatedReport.$inferSelect
