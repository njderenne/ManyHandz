/**
 * STACK — the technical manifest: every technology this app is built on, as configured, in one
 * typed structure. Three audiences:
 *   1. Humans — rendered at /stack (Settings → About → Tech stack) to see/explain the choices.
 *   2. AI agents — a single file to read for ground truth on what powers each capability.
 *   3. The factory — the seed of the fleet "module manifest" (DECISIONS #10): what's enabled here.
 * Keep entries in technical verbiage and keep this file in sync when swapping providers.
 */
export type StackEntry = {
  name: string
  /** The specific technology/provider, in technical terms. */
  tech: string
  detail: string
}

export type StackGroup = { title: string; entries: StackEntry[] }

export const STACK: StackGroup[] = [
  {
    title: 'App platform',
    entries: [
      {
        name: 'Framework',
        tech: 'Expo SDK 56 · React Native 0.85 · React 19',
        detail: 'Native-first (iOS + Android), New Architecture enabled; web via React Native Web as a secondary surface.',
      },
      {
        name: 'Navigation',
        tech: 'Expo Router (typed routes)',
        detail: 'File-based routing; tab hubs with nested stacks; compile-time checked route strings.',
      },
      {
        name: 'Styling',
        tech: 'NativeWind 4 (Tailwind CSS 3)',
        detail: 'CSS-variable design tokens, light/dark/system theming, no per-component dark variants.',
      },
      {
        name: 'Motion',
        tech: 'Reanimated 4 + react-native-worklets · Gesture Handler',
        detail: 'UI-thread animation (sliders, segmented pill, chart crosshair) — no JS-thread jank.',
      },
      {
        name: 'Charts',
        tech: 'victory-native (Victory Native XL) + Skia',
        detail: 'GPU-rendered interactive charts with UI-thread drag-to-value; react-native-svg sparklines for cheap inline use.',
      },
    ],
  },
  {
    title: 'Backend',
    entries: [
      {
        name: 'API host',
        tech: 'Cloudflare Workers + Hono',
        detail: 'Edge-deployed API + static SPA host; sub-router per concern; real 404s on unknown API paths.',
      },
      {
        name: 'Database',
        tech: 'Neon serverless Postgres + Drizzle ORM',
        detail: 'HTTP driver (Worker-fit, one round-trip per query); migrations via drizzle-kit; one database per app.',
      },
      {
        name: 'Auth & tenancy',
        tech: 'Better-Auth (organization plugin)',
        detail: 'Email/password, Google + Apple OAuth, passkeys; bearer sessions for native (SecureStore) with the Expo origin plugin; multi-tenant orgs with roles + email invites.',
      },
    ],
  },
  {
    title: 'AI',
    entries: [
      {
        name: 'Tiered completion',
        tech: 'classify → OpenAI gpt-4o-mini · reason → Claude Sonnet 4.6 · complex → Claude Opus 4.8',
        detail: 'Cost-aware: each task tier maps to the cheapest capable model; Opus runs adaptive thinking; every model env-overridable.',
      },
      {
        name: 'Streaming',
        tech: 'Server-streamed text (Hono streamText → expo/fetch)',
        detail: 'Tokens render as the model writes them — first text in ~1s instead of waiting for the full response.',
      },
      {
        name: 'Vision & image generation',
        tech: 'Grok (xAI, via OpenAI SDK pointed at api.x.ai)',
        detail: 'Image understanding + generation tier.',
      },
    ],
  },
  {
    title: 'Media & voice',
    entries: [
      {
        name: 'Text-to-speech / speech-to-text',
        tech: 'ElevenLabs (TTS + Scribe STT)',
        detail: 'Proxied through the Worker; spoken phrases cached on-device for instant replay; native multipart upload for transcription.',
      },
      {
        name: 'Background removal',
        tech: 'rembg (U²-Net) via rembg.com hosted API',
        detail: 'Transparent-PNG subject extraction; provider chain supports a self-hosted rembg service or Replicate.',
      },
      {
        name: 'Camera & photos',
        tech: 'expo-image-picker',
        detail: 'Library pick + camera capture; iOS HEIC transcoded to JPEG on the way out (upload-safe).',
      },
      {
        name: 'Audio & sounds',
        tech: 'expo-audio',
        detail: 'Playback + recording (mic permission flow); pre-warmed UI sound effects, user-toggleable.',
      },
    ],
  },
  {
    title: 'Communications & billing',
    entries: [
      {
        name: 'Transactional email',
        tech: 'Resend',
        detail: 'Password reset, verification, welcome, organization invites — HTML templates in the Worker.',
      },
      {
        name: 'Push notifications',
        tech: 'Expo Push Service (expo-notifications)',
        detail: 'Device tokens stored per user in Postgres; Worker sends via exp.host with per-ticket error handling.',
      },
      {
        name: 'Billing',
        tech: 'Stripe (Checkout + Customer Portal + webhooks)',
        detail: 'Org-scoped subscriptions; webhook-driven billing columns on the organization row. (Keys pending activation.)',
      },
    ],
  },
  {
    title: 'Device capabilities',
    entries: [
      {
        name: 'Biometrics & security',
        tech: 'expo-local-authentication · expo-secure-store',
        detail: 'Face ID / Touch ID / passcode unlock; PIN lock; session tokens in the platform keychain.',
      },
      {
        name: 'Calendar · Haptics · QR',
        tech: 'expo-calendar · expo-haptics · react-native-qrcode-svg',
        detail: 'Device-calendar event creation; user-toggleable tactile feedback; QR rendering.',
      },
    ],
  },
  {
    title: 'State, data & quality',
    entries: [
      {
        name: 'Server state',
        tech: 'TanStack Query (persisted)',
        detail: 'Offline-aware cache, AsyncStorage persistence, query-key registry.',
      },
      {
        name: 'Client state',
        tech: 'Zustand (persisted)',
        detail: 'Theme mode + user preferences (haptics/sounds) survive restarts; readable outside React.',
      },
      {
        name: 'Forms & validation',
        tech: 'react-hook-form + zod',
        detail: 'Schema-validated forms with inline errors.',
      },
      {
        name: 'Tests',
        tech: 'Vitest',
        detail: 'Unit tests on lib + email templates; verification gates: app/worker typecheck, web export, Worker bundle dry-run.',
      },
    ],
  },
  {
    title: 'Shipping & operations',
    entries: [
      {
        name: 'Build & store pipeline',
        tech: 'EAS Build · Submit · Update',
        detail: 'Cloud iOS/Android builds, programmatic store submission, and over-the-air JS updates per channel (development/preview/production).',
      },
      {
        name: 'Secrets & config',
        tech: 'Wrangler secrets + EAS environment variables',
        detail: 'Worker secrets via wrangler; build-time keys (e.g. Google Maps) via EAS env; app identity in src/lib/config.',
      },
    ],
  },
]
