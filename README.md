# Template — the AppFactory canonical chassis

Every app is minted from this. See the repo root for full context: [`../README.md`](../README.md), the canonical stack [`../APPFACTORY_STACK.md`](../APPFACTORY_STACK.md), the [`../FEATURE_CATALOG.md`](../FEATURE_CATALOG.md), and [`../DECISIONS.md`](../DECISIONS.md). The native-first rationale is in [`../EXPO_ROUTE.md`](../EXPO_ROUTE.md).

**Stack:** Expo (React Native) + React 19 · Expo Router · TanStack Query · NativeWind (Tailwind v3) + Reanimated · Cloudflare Workers (Hono) · Neon + Drizzle · Better-Auth · EAS Build/Submit/Update. Native-first (iOS + Android); web via React Native Web.

## Quick start

> **Expo Go does not work with this template** — it pins a canary Expo SDK (56 / RN 0.85 / React 19.2) newer than any released Expo Go. Run on a device via an **EAS development build** (once per platform; rebuild only when native modules change), then iterate with the dev client. Web preview works at `http://localhost:8081`.

```bash
npm install
cp .env.example .env           # fill in secrets (Neon, Better-Auth, Stripe, Resend, AI)

eas build --profile development --platform ios   # once (or --platform android) — installs the dev client on your device
npx expo start --dev-client    # daily dev server — hot-reloads JS to the dev client; web at :8081
npm run cf:dev                 # Cloudflare Worker (API + auth) on :8787, second terminal
```

Point the app at the Worker by setting `EXPO_PUBLIC_API_URL` in `.env` (e.g. `http://localhost:8787`).

Web build (the secondary surface, served by the Worker):

```bash
npm run export:web             # metro web bundle → dist/
npm run cf:dev                 # Worker serves dist/ + API
```

Database (both scripts delegate to `worker/`, where drizzle-kit lives; `db:migrate` reads `DATABASE_URL` from the process env — set it in the shell before running):

```bash
npm run db:generate            # generate a migration from the Drizzle schema
npm run db:migrate             # apply migrations to the configured Neon DB (needs DATABASE_URL in env)
```

Native builds + store submission (needs an Expo account + EAS; run from a machine with the native toolchains or use EAS cloud builds):

```bash
npm run eas:build:ios          # cloud build (no local Xcode required)
npm run eas:submit:ios         # upload to App Store Connect
npm run eas:build:android      # cloud build
npm run eas:submit:android     # upload to Google Play
npm run eas:update             # OTA JS/asset update to installed apps (fleet maintenance)
```

> **Testing on a real device, off your network (e.g. at the gym), or sharing a private beta?** See [`TESTING.md`](./TESTING.md) — dev builds vs. standalone preview builds, TestFlight / Play internal testing, whether API/AI calls work off-network, and when a change needs a rebuild vs. an over-the-air `eas update` (and what counts against your build quota).

## Layout

```
app/             Expo Router screens (file-based routing) — _layout.tsx + screens
src/
  components/
    ui/          vendored + re-themed RN primitives (react-native-reusables style)
    <feature>/   feature components
  lib/
    config/      app, navigation, roles (config-driven identity)
    db/          Drizzle schema + Neon client
    query/       keys.ts + client (AsyncStorage offline) + hooks/ (canonical CRUD)
    api/         typed fetch wrapper (absolute Worker URL on native)
    auth/        Better-Auth Expo client
    native/      Expo module wrappers + platform fallbacks
    ai/          providers + rate-limit
worker/          Cloudflare Worker (Hono): API, auth, webhooks, cron, DOs
drizzle/         migrations
global.css       NativeWind entry (Tailwind directives); tokens live in tailwind.config.js
```

## Build phases

- [x] **1. Boot skeleton** — Expo Router + NativeWind tokens + Hono worker + `/api/health`
- [x] **2. Data layer** — Drizzle schema + Neon client + query/offline infrastructure
- [x] **3. Auth + tenancy** — Better-Auth (email/Google/Apple/bearer) + organization plugin; Expo auth client
- [x] **4. Chassis UI** — RN primitives + layout chrome + TenantSwitcher + hub navigation + Settings/Account/Team + auth screens (incl. forgot/reset password)
- [x] **5. Billing + comms** — Stripe + Resend + AI providers (code complete; Stripe awaits live keys)
- [ ] **6. Native polish + store pipeline** — push E2E + EAS Build/Submit/Update (OTA channels live) ✅; store asset/metadata pipeline remaining

See [`../DECISIONS.md`](../DECISIONS.md) for current status and rationale.
