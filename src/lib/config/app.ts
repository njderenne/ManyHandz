/**
 * APP_CONFIG — the single place to brand a new app minted from this template.
 * The factory rewrites these fields per app; everything else reads from here.
 */
export const APP_CONFIG = {
  name: 'App Template',
  shortName: 'Template',
  description:
    'The AppFactory canonical chassis — Expo (React Native) native-first, Cloudflare Workers, Neon + Drizzle, Better-Auth.',
  url: 'https://example.com',
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
    peerPayments: false,
    realtime: false,
    haptics: true,
    push: false,
    gps: false,
    camera: false,
    biometrics: false,
    maps: true, // Android needs GOOGLE_MAPS_API_KEY baked into the build (EAS env var — set)
    qr: false,
    voice: false, // mic voice-notes → speech-to-text (expo-audio; needs an EAS dev build + /api/voice/stt configured)
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
    trialDays: 14,
    gracePeriodDays: 3,
  },
  /**
   * Measurement units — the per-app default display system for heights/weights/distances.
   * Device preference (Preferences → Units) overrides this; it only seeds the initial value.
   */
  units: {
    default: 'imperial' as 'imperial' | 'metric',
  },
  /**
   * Monetization — the tier ladder plus per-app slots for what each app sells. The paywall
   * (app/paywall.tsx) renders plan cards from `tiers`; TierGate/useHasTier rank against the
   * FREE → STANDARD → PREMIUM ladder. Labels are display copy — rename per app (e.g. "Plus").
   */
  monetization: {
    tiers: {
      FREE: { label: 'Free' },
      STANDARD: { label: 'Pro' },
      PREMIUM: { label: 'Premium' },
    },
    /** Per-app free-tier limits, e.g. `{ plants: 3 }` — screens read these to gate creation. */
    limits: {} as Record<string, number>,
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
    singular: 'Organization',
    plural: 'Organizations',
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
