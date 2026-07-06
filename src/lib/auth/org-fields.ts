/**
 * Client-side declaration of the `organization` additionalFields (SPINE_SPEC §3.4).
 *
 * MUST mirror worker/auth.ts → `organization({ schema: { organization: { additionalFields } } })`
 * exactly (same names + types). The server persists these columns on `organization.create`;
 * declaring them here on the client's `organizationClient({ schema })` is what threads them
 * through the inferred types of `useActiveOrganization()` / `useListOrganizations()` — without
 * it, `activeOrg.kind` would be untyped and the context layer couldn't branch on kind type-safely.
 *
 * Shared by client.ts (native) and client.web.ts (web) so both Metro builds infer the same shape,
 * and imported by worker/auth.ts + worker/routes/org-settings.ts so client, server, and the
 * settings PATCH allowlist can never drift apart.
 *
 * Apps APPEND their per-kind extension columns here (grindline: minorSocialApproval, sport, …) —
 * one entry per nullable/defaulted column added to `organization` (SPINE §3.3), e.g.:
 *
 *   sport: { type: 'string', required: false, input: true },
 *   minorSocialApproval: { type: 'boolean', required: false, input: true },
 *
 * `input: true` means the CLIENT may send the field on create/update — which is exactly why
 * `kind` is server-validated in beforeCreateOrganization (worker/lib/spine-hooks.ts) and treated
 * as IMMUTABLE by the org-settings PATCH (changing an org's kind post-create would orphan its
 * members' role vocabulary).
 */
export const ORG_ADDITIONAL_FIELDS = {
  // 'team' (default) | 'personal' (reserved, provision-user only) | app-declared kinds — the
  // tenant discriminator (TEXT, never an enum; see src/lib/config/roles.ts KINDS).
  kind: { type: 'string', required: false, input: true },
} as const
