/**
 * APP_CONFIG — the single place to brand a new app minted from this template.
 * The factory rewrites these fields per app; everything else reads from here.
 */
export const APP_CONFIG = {
  name: 'ManyHandz',
  shortName: 'ManyHandz',
  description:
    'One chore app for families and roommates — assign and auto-rotate chores, score fairness, photo-verify completion, and gamify it for kids. Many hands make light work.',
  url: 'https://manyhandz.io',
  /** Native deep-link scheme — MUST match app.json `scheme` (single source for wiring that can't
   *  import app.json, e.g. worker/auth.ts trustedOrigins — MINOR-9). */
  scheme: 'manyhandz',
  /**
   * Fleet standard: one monitored studio inbox serves every minted app (display-name carries the
   * per-app identity — see worker/email/mailer.ts). Do NOT create per-app support mailboxes.
   */
  support: {
    email: 'support@criterial.io',
  },
  /** Feature flags — opt-in modules from the catalog. Flip per app to light up UI + endpoints. */
  features: {
    ai: true,
    passkeys: true,
    peerPayments: true, // Settle-Up: payment handles (Venmo/PayPal/Cash App) for money IOUs
    realtime: false,
    haptics: true,
    push: true,
    gps: false,
    camera: true,
    biometrics: true, // app-lock (Face ID + PIN) for kid accounts / parent-only areas
    maps: false,
    qr: true, // QR household-join invites
    voice: false,
    // ── 2026-07-05 harvest modules (all opt-in; flag lights up UI + endpoints + cron steps) ──
    subjects: false,     // Subject primitive (Person ≠ Member ≠ User) — MH members ARE the roster
    shareGrants: false,  // named, scoped, time-boxed outsider access (+ public /api/grant surface)
    oversight: false,    // capability-gated cross-member reads (worker/lib/oversight.ts)
    escalations: false,  // escalation ladder + cron sweep (safety module — N/A for chores)
    prompts: false,      // versioned prompt catalog + cadence-windowed nudge cron
    reports: false,      // range-metrics report generator (MH has its own weekly report card)
    catalog: false,      // seeded reference catalog (MH chore categories are richer, kept)
    health: false,       // HealthKit / Health Connect bridge
    wearables: false,    // provider cron-sync half
    gpsRoutes: false,    // foreground live route tracking
    export: true,        // org data export (JSON/CSV/print-HTML) — data-ownership promise
  },
  /**
   * Social auth providers — gate the "Continue with Google/Apple" buttons on the login screen.
   * Both ship false: Google needs a per-app OAuth client and Apple is an unfilled gap, so dead
   * buttons never reach the store. The mint flips one true once that provider is configured
   * (OAuth client + redirect URI for Google; Sign in with Apple capability for Apple).
   */
  auth: {
    google: false,
    apple: false,
  },
  /**
   * Signed-out entry policy — the global auth gate (src/lib/auth/use-require-auth.ts).
   *
   * 'landing' (default) = a signed-out WEB visitor sees the public marketing page at /landing
   * (landing.tsx — hero, feature cards, and its own "log in / get started" header). Native apps still
   * go straight to /login regardless of this setting: someone who already installed the app doesn't
   * need a marketing pitch, so the gate collapses to /login off-web. 'login' = a hard auth wall
   * everywhere including web (account-first apps and internal tools). Either way the rest of the app
   * stays gated — only the auth screens, legal pages, onboarding, and invite deep links are ever
   * public, and /landing is already in PUBLIC_PREFIXES so neither mode needs another change.
   */
  authGate: {
    redirectTo: 'landing' as 'login' | 'landing',
  },
  subscription: {
    /** LOCKED pricing decision (appfactory-manyhandz-pricing, 2026-06-25): 14-day trial. The
     *  interval-aware checkout clamp (worker/billing/trial.ts) trims WEEKLY-plan checkout trials
     *  to 7 days (monthly/yearly keep 14) — William-approved 2026-07-06. */
    trialDays: 14,
    gracePeriodDays: 3,
    /** The single sold plan lives in the STANDARD slot (see monetization) — trials lift to it. */
    trialTier: 'STANDARD' as 'STANDARD' | 'PREMIUM',
    /**
     * Which org creations bootstrap an in-app trial (stamps trialing + trialEndsAt; paid features
     * work during the trial with NO subscription row — effectiveTier lifts on trialEndsAt):
     * 'all' — every household gets its trial at creation (the household/setup route re-stamps from
     * setup time, same config source). Trials are per-org; `limits.tenants` is the anti-farming
     * control (unset for MH — households are cheap and joining is the growth loop).
     */
    trialOnOrgCreate: 'all' as 'all' | 'personal' | 'none',
  },
  /**
   * Measurement units — the per-app default display system for heights/weights/distances.
   * Device preference (Preferences → Units) overrides this; it only seeds the initial value.
   */
  units: {
    default: 'imperial' as 'imperial' | 'metric',
  },
  monetization: {
    /**
     * ManyHandz sells ONE paid tier — "Premium" — for the whole household. The ladder still ranks
     * FREE < STANDARD < PREMIUM (entitlements.ts / useSubscription), so the single paid plan lives
     * in the STANDARD slot (the lowest paid rank): every gate is `requireTier(…, 'STANDARD')` and
     * TierGate min="STANDARD". The PREMIUM slot is intentionally unsold (sellableTiers below —
     * the server-side /plans filter is authoritative); its label stays DISTINCT from STANDARD so a
     * future PREMIUM price never renders two identically-named cards.
     *
     * V5: the paywall's baked copy lives HERE so app/paywall.tsx is byte-identical fleet-wide.
     * Live Stripe Product metadata (label/features) overrides at runtime; `fallback` renders when
     * plans are unresolved. Price labels mirror the locked grid (weekly $2.99 · monthly $5.99 ·
     * yearly $39.99 — the monthly figure anchors the fallback).
     */
    tiers: {
      FREE: {
        label: 'Free',
        fallback: {
          priceLabel: '$0',
          features: ['Everything you need to get started', 'One household'],
        },
      },
      STANDARD: {
        label: 'Premium',
        fallback: {
          priceLabel: '$5.99 / month',
          features: [
            'Everything in Free',
            'Unlimited chores & members',
            'AI photo verification',
            'Priority support',
          ],
        },
      },
      PREMIUM: {
        label: 'Premium Plus',
        fallback: {
          priceLabel: '$9.99 / month',
          features: ['Everything in Premium', 'Advanced AI features', 'Early access to new features'],
        },
      },
    },
    /** Tiers the paywall SELLS — MH sells FREE + the one paid plan (BILLING §11.7 wave 1). */
    sellableTiers: ['FREE', 'STANDARD'] as ('FREE' | 'STANDARD' | 'PREMIUM')[],
    /** Freemium — never a hard wall. */
    requireSubscription: false,
    /** Tier the one-time Lifetime SKU would grant. Dormant — no STRIPE_PRICE_LIFETIME configured. */
    lifetimeTier: 'PREMIUM' as 'STANDARD' | 'PREMIUM',
    /**
     * Free-tier limits, ENFORCED server-side (worker/billing/limits.ts + the app's own routes).
     * RESERVED chassis keys: members (Better-Auth membershipLimit + the QR-join cap) · tenants ·
     * mediaGb · historyDays. App keys: `lists` = max active chore definitions a FREE household
     * keeps (worker/routes/chores.ts).
     */
    limits: { lists: 3, members: 3 } as Record<string, number>,
    /** Per-app feature keys that require a paid tier, e.g. `['ai-diagnosis', 'export']`. */
    paidFeatures: [] as string[],
  },
  /**
   * Engagement economy — per-app tuning knobs for the credits/referrals tier. The Worker reads
   * these to size awards (worker/routes/referrals.ts); client screens read them for copy.
   */
  engagement: {
    referrals: {
      /** Credits awarded to the inviter when their code is redeemed. */
      referrerCredits: 500,
      /** Credits awarded to the new user redeeming the code. */
      redeemerCredits: 250,
    },
  },
  /** Display alias for the tenant primitive (e.g. "Household", "Team", "Care Circle"). */
  tenant: {
    singular: 'Household',
    plural: 'Households',
    /** Team-first: households are created/joined during onboarding — no auto personal org. */
    autoPersonalOrg: false,
    /** MH ships its OWN onboarding gate (src/lib/hooks/useOnboarding.ts) — the chassis
     *  use-context-guard stays unmounted ('none'). */
    onboarding: 'none' as 'none' | 'require-create',
  },
  /** Display vocab for the subject primitive — DORMANT (features.subjects=false); chassis default. */
  subjects: {
    kinds: [
      { kind: 'person', singular: 'Person', plural: 'People', allowSelfLink: true },
    ] as ReadonlyArray<{ kind: string; singular: string; plural: string; allowSelfLink: boolean }>,
  },
  /** Share-grant policy — DORMANT (features.shareGrants=false); chassis defaults. */
  grants: {
    maxDurationDays: 30,
    revokeOnLapse: false,
  },
  /** Escalation-ladder policy — DORMANT (features.escalations=false); chassis defaults. */
  safety: {
    escalation: {
      stages: ['reminder', 'follow_up', 'alert', 'missed'] as readonly string[],
      dwellMinutes: { reminder: 15, follow_up: 30, alert: 60 } as Record<string, number>,
      smsStage: 'alert' as string | null,
      dailySmsCap: 10,
    },
  },
  /**
   * Legal config — interpolated into /terms and /privacy. Fleet standard: the studio (Criterial)
   * is a Wisconsin company, so Wisconsin governs unless a specific app needs otherwise.
   */
  legal: {
    jurisdiction: 'the State of Wisconsin, United States',
  },
  /**
   * Help center content (app/help.tsx). Replace per app with product-specific questions; keep
   * the account/billing/data entries — every app needs them and reviewers look for them.
   */
  help: {
    faqs: [
      {
        q: 'How do I reset my password?',
        a: 'On the sign-in screen tap "Forgot password" and we\'ll email you a reset link. Links expire after one hour — request a fresh one if it lapses.',
      },
      {
        q: 'How does my subscription work?',
        a: 'Your plan renews automatically until you cancel. You can manage or cancel any time from Account → Manage subscription; access continues to the end of the paid period.',
      },
      {
        q: 'How do I invite people to my organization?',
        a: 'Open the team screen, tap Invite, and enter their email. They\'ll receive a link that adds them with the role you chose.',
      },
      {
        q: 'How do I delete my account?',
        a: 'Account → Danger zone → Delete account. This permanently removes your data within 30 days, as described in the privacy policy.',
      },
      {
        q: 'Does the app work offline?',
        a: 'Recently loaded content stays available offline and the app reconnects automatically. Anything that needs the server will resume when you\'re back online.',
      },
    ],
  },
  /** What's-new entries (app/changelog.tsx) — newest first; shown to users, keep it human. */
  changelog: [
    {
      version: '0.1.0',
      date: '2026-06-11',
      notes: ['First internal build — accounts, organizations, billing, and the full component chassis.'],
    },
  ],
} as const

export type AppConfig = typeof APP_CONFIG
