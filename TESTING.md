# Testing & Distribution

How to run, test, and share an app built from this template — from your desk to the gym to the App Store. If you're coming from a web-first workflow, the key reframe is at the top.

---

## The mental model (read this first)

Two completely different servers are involved, and **only one cares about your WiFi:**

- **Metro** — the dev server on your computer. It streams your *JavaScript* to the app for hot-reload during development. This is what requires same-WiFi (or a tunnel). It is **not** your backend.
- **Your Cloudflare Worker** — the backend, deployed to a **public HTTPS URL** on the internet. All API/AI calls go here, over the internet, **from anywhere**.

And two kinds of builds:

| | Needs your computer running? | Runs on any network? | For |
|---|---|---|---|
| **Dev build + Metro** | Yes (same WiFi, or `--tunnel`) | No | Fast local iteration, hot reload |
| **Standalone build** (`preview` / `production`) | **No** — the JS is bundled in | **Yes** | Real-world testing, beta, store |

A standalone build has the JS baked in **and** talks to your deployed Worker over the internet. It does not depend on your laptop at all.

---

## 1. The dev loop (local, fast)

Your everyday loop. Hot-reloads JS onto a connected device.

```bash
eas build --profile development --platform ios   # once (or :android) — installs the dev client
npx expo start --dev-client                       # then, every day
```

- The device must reach Metro: **same WiFi**, or run `npx expo start --dev-client --tunnel` to connect over the internet (slower; uses an ngrok tunnel).
- Rebuild the dev client only when you add a **native module**; JS changes just hot-reload.

---

## 2. Testing off your network / in the real world (e.g. at the gym) 🏋️

Use a **preview build** — a standalone app with the JS baked in. No computer, no Metro, works on cellular/gym-WiFi/offline.

```bash
eas build --profile preview --platform ios     # or :android
```

- **Android** → produces an **APK**; install directly from the EAS link/QR.
- **iOS** → installs on your **registered device** (see `eas device:create`) via the EAS link.
- This is the native equivalent of "deploy to a staging URL and open it anywhere."

---

## 3. Sharing with testers (private alpha/beta — not a public store listing)

These distribute *through* Apple/Google's infrastructure but are **invisible to the public store**:

- **iOS → TestFlight**: `eas submit --platform ios` pushes the build to App Store Connect; testers install via the **TestFlight app** with an invite link. Up to 100 internal testers with **no review**, instantly.
- **Android → Play "Internal testing"**: upload to the internal track; testers opt in via a link and install from the Play Store (hidden from the public). ~100 testers, ready in minutes, no review.

---

## 4. Updating: rebuild vs. over-the-air (this is the important one)

**EAS Update** ships JS/asset changes over-the-air. Installed apps pull the new bundle on next launch — **no rebuild, no store review.**

```bash
eas update --channel preview --message "tweak copy"   # OTA to all preview installs
```

| Your change | How to ship it | Counts as an EAS *build*? |
|---|---|---|
| JS / React components / styles / logic / most assets | `eas update` (OTA) | **No** |
| New/changed **native module**, permissions, app config, SDK bump, icon/splash, bundle id | `eas build` + reinstall | **Yes** |

- **Build quota:** EAS Build's free tier includes a limited number of builds/month (see [expo.dev/pricing](https://expo.dev/pricing); paid tiers raise it). Because most day-to-day changes are JS, they go out via `eas update` and **burn zero builds** — you only spend a build when you touch native code.
- **EAS Update** has its own (separate, cheaper) pricing and is generous on the free tier.
- Channels map to build profiles: a `preview` build listens on the `preview` channel, `production` on `production` — so `eas update --channel preview` only reaches preview installs.

---

## 5. Do API / AI calls work in a standalone build?

**Yes** — because your backend is a public internet server, not Metro.

```
Your app  ──HTTPS over internet──►  Your Cloudflare Worker  ──►  OpenAI / Anthropic / Stripe / …
```

The app **never calls AI providers directly** — it calls *your Worker*, which calls them server-side. So API keys live on the Worker (as secrets) and never ship inside the app.

**The one thing to configure:** `EXPO_PUBLIC_API_URL` is the address the app calls, and it's **baked into the build at build time**.

- In dev it's often `http://localhost:8787` (your local `wrangler dev`). That is **useless in a standalone build** — `localhost` on the phone means the phone itself.
- For `preview`/`production` builds, set `EXPO_PUBLIC_API_URL` to your **deployed Worker's public URL** (e.g. `https://manyhandz.<account>.workers.dev` or your custom domain), via [EAS environment variables](https://docs.expo.dev/eas/environment-variables/) or `eas.json` per-profile `env`.

So a fully functional gym-testable build needs the backend live:

```bash
# from worker/ — deploy the Worker and set its secrets
npm run deploy                              # (root) builds web + deploys the Worker → public URL
npm --prefix worker exec wrangler secret put OPENAI_API_KEY      # repeat for ANTHROPIC_API_KEY, DATABASE_URL, …
# then build preview with EXPO_PUBLIC_API_URL pointing at that URL
```

> Until the Worker + Neon are deployed, a standalone build runs the **UI** fine but shows "API unreachable" for backend calls — same as the dev build does today.

---

## The web → app ladder (side by side)

| Web-first (old habit) | App-first (this template) |
|---|---|
| `localhost` dev server | Dev build + Metro (same WiFi / `--tunnel`) |
| Deploy to a staging URL | **Preview build** (standalone, runs anywhere) |
| Share the staging link | **TestFlight / Play Internal Testing** |
| Deploy to production | `eas submit` → store |
| Hotfix the deploy | **EAS Update** (OTA, no rebuild) |

---

## Quick reference

```bash
# dev (hot reload, same WiFi or --tunnel)
npx expo start --dev-client

# standalone build to test anywhere (gym, cellular, offline)
eas build --profile preview --platform ios        # or :android

# private beta to testers
eas submit --platform ios                          # → TestFlight
#   (Android: upload the build to Play Console → Internal testing)

# ship a JS-only change with NO rebuild
eas update --channel preview --message "..."

# real release
eas build --profile production --platform ios && eas submit --platform ios
```
