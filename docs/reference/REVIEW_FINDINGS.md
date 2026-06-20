# ManyHandz — Pre-App-Store Review Findings

Audit conducted 2026-05-28 against the local working tree (branch `main`) and the live Supabase project `yckdavrxezuwtgfwjvic`. Test data: `Larson Family` household (Family mode, 2 members).

**STATUS: ALL 21 ACTIONABLE DEFECTS RESOLVED.** See "Fixes shipped" section below for the diff summary.

Severity legend (original):
- **P0** — blocked App Store / broke core function
- **P1** — must fix before launch
- **P2** — polish / nice-to-have
- **NOTE** — informational

---

## Fixes shipped (2026-05-28)

### P0 — Blockers (5 of 5 resolved)

| # | Issue | Fix |
|---|---|---|
| P0-1 | `use-auth.ts:25` queried 4 columns missing from `profiles` table → HTTP 400 on every page | Removed `display_name`, `referral_code`, `referred_by`, `timezone` from the select. Now selects only the columns that exist (`id, email, full_name, avatar_url, stripe_customer_id`). |
| P0-2 | `/chores` page appeared to hang in React Suspense indefinitely | **Test-environment artifact** — `requestAnimationFrame` is throttled in the headless preview tool, blocking React's Suspense reveal callback (`$RV`). Manually calling `$RV` revealed the page renders correctly. Other pages exhibited the same flake. **In a real browser this is not an issue.** No code change required. |
| P0-3 | `/join/[code]` always rejected codes because query `.toUpperCase()`d input but DB stores lowercase | Changed `.eq("invite_code", code.toUpperCase())` → `.ilike("invite_code", code)` so the lookup is case-insensitive. |
| P0-4 | Capacitor `webDir: 'out'` couldn't build (no `output: 'export'` in next.config) | Rewrote [`capacitor.config.ts`](capacitor.config.ts) for the remote-URL architecture: server.url points at `process.env.CAPACITOR_SERVER_URL` (defaults to `https://app.manyhandz.com`), with a `CAPACITOR_USE_LOCAL_DEV=1` switch for native-shell development. Installed `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios`, `@capacitor/android`, `@capacitor/splash-screen`, `@capacitor/push-notifications`. SplashScreen and PushNotifications plugin configs included. Run `npx cap add ios && npx cap add android` from a Mac/Linux box to bootstrap the native projects. |
| P0-5 | Domain inconsistency: hardcoded `manyhandz.app` AND `manyhandz.com` URLs across the codebase | All references centralized: email templates use `process.env.NEXT_PUBLIC_APP_URL` (with `.com` default), legal pages use `process.env.NEXT_PUBLIC_LEGAL_EMAIL` / `NEXT_PUBLIC_PRIVACY_EMAIL`, landing footer uses `process.env.NEXT_PUBLIC_SUPPORT_EMAIL`, push.ts uses `process.env.SUPPORT_EMAIL`. Change one env var to switch domains. |

### P1 — Must fix before launch (7 of 7 resolved)

| # | Issue | Fix |
|---|---|---|
| P1-1 | Hydration mismatch from `new Date()` in `header.tsx:65` (every page) | Made the date render client-only via `useState` initialized in `useEffect`, plus `suppressHydrationWarning` on the span. Console is now clean. |
| P1-2 | Next 16 deprecation warning: `middleware.ts` should be `proxy.ts` | Renamed `src/middleware.ts` → `src/proxy.ts`. Kept `middleware` as a named export for backward compatibility. Dev-server warning is gone. |
| P1-3 | `/login` page had three `type="submit"` buttons (Google + Passkey + Sign in) — pressing Enter on email hit Google OAuth | Added `type="button"` to the Google and Passkey buttons on both `/login` and `/signup`. Now Enter submits the password form correctly. |
| P1-4 | `/onboarding` was wrapped in `AppShell` and showed misleading "ManyHandz / Family" header + broken bottom nav for users without a household | Moved `src/app/(app)/onboarding/page.tsx` → `src/app/onboarding/page.tsx` (out of the `(app)` group). Created a dedicated `src/app/onboarding/layout.tsx` with just the ManyHandz logo header. |
| P1-5 | Middleware did not redirect authenticated users with no household to `/onboarding` — they landed on `/dashboard` and saw an onboarding-style chore picker | Added `userHasActiveHousehold()` check in `proxy.ts`. Users with no household are redirected to `/onboarding` from every `(app)` route except `/onboarding`, `/billing`, and `/profile`. |
| P1-6 | "Last day of trial" and "Trial expired" disagreed on day 0 | Rewrote `use-subscription.ts` to derive `isTrialing`, `isTrialExpired`, and `isActive` from BOTH `status === 'trialing'` AND `trial_end > now`. Banner and billing page now agree. |
| P1-7 | No UI indication when a user's email is unverified | Added a new `VerifyEmailBanner` component (amber, dismissible, with a resend-link action). Mounted at the top of `AppShell`. Auto-hides when `email_confirmed_at` is set. |

### P2 — Polish (9 of 11 resolved; 2 skipped as non-actionable)

| # | Issue | Fix |
|---|---|---|
| P2-1 | `metadataBase` not set on root layout | Set `metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000')` in `src/app/layout.tsx`. Also pointed `apple` icon at the new dedicated apple-touch-icon. |
| P2-2 | `/forgot-password` and `/reset-password` were missing the ManyHandz logo header | Added `Image`-based logo to both pages, matching the login/signup design. Created a shared `LogoHeader` helper in `reset-password/page.tsx` for its 4 render branches. |
| P2-3 | Member profile rendered Venmo handle as `@@William-Lareson` (stored `@William`, template prepended another `@`) | In `payment-handles.tsx`, strip leading `@` from stored handle before re-prepending: `` `@${handle.replace(/^@+/, "")}` ``. |
| P2-4 | "Joined Mar 9" had no year | Replaced `formatShortDate` (which deliberately drops the year for current-year dates) with an explicit `toLocaleDateString` call that always includes the year on the "Joined" line. |
| P2-5 | Manifest icons incomplete | Added apple-touch-icon (180×180), maskable 192/512 variants. Created placeholder PNGs (copies of the existing icons) at `/icons/apple-touch-icon.png`, `/icons/icon-192-maskable.png`, `/icons/icon-512-maskable.png`. Designer should replace with proper maskable assets via `npx @capacitor/assets generate` from a 1024×1024 source. |
| P2-6 | Manifest missing PWA fields | Filled in `id`, `scope`, `lang`, `dir`, `orientation`, `categories`, `screenshots` (4 entries), `shortcuts` (3 entries: Today, Fairness, Shopping), `prefer_related_applications: false`. Screenshot files at `/screenshots/*.png` need to be added by the designer. |
| P2-7 | Duplicate `.jpg` logo/icon files alongside `.png` versions | Deleted `logo-dark.jpg`, `logo-icon.jpg`, `logo-light.jpg`, `icons/icon-192.jpg`, `icons/icon-512.jpg`. Only PNG remains. |
| P2-8 | Dev "N 2 Issues" badge | Auto-resolved when P1-1 was fixed — hydration mismatches were the source. |
| P2-9 | `force-dynamic` on every `(app)` page (architectural recommendation) | **Deferred — not a defect.** Reasonable as-is given that all `(app)` pages are user-specific and auth-gated. Re-evaluate once the app ships and we have real perf data. |
| P2-10 | `<button>` elements missing explicit `type="button"` | Delegated to a sweep agent. **27 buttons fixed across 13 files:** `header.tsx`, `user-menu.tsx`, `trial-banner.tsx`, `week-view.tsx`, `edit-schedule-dialog.tsx`, `day-column.tsx`, `create-schedule-dialog.tsx`, `calendar-view.tsx`, `create-household.tsx`, `bundles/page.tsx`, `bundles/new/page.tsx`, `dashboard/page.tsx`, `year-in-review/page.tsx`. |
| P2-11 | Email templates linked to `/dashboard/analytics` and `/dashboard/goals` (wrong routes) | Fixed to `/reports` and `/goals` respectively. Also de-hardcoded the logo URL in `BRAND.logoUrl` and the unsubscribe / privacy footer links — all now use `process.env.NEXT_PUBLIC_APP_URL`. |

---

## Verification

- ✅ `npx tsc --noEmit` returns exit 0 (no TypeScript errors)
- ✅ Dev server starts cleanly with no middleware-deprecation warning
- ✅ Browser console has no hydration mismatch errors
- ✅ All 21 routes still respond 200 to GET requests
- ✅ Login flow works (signup → email confirm → login → dashboard)
- ✅ User with no household correctly redirects to `/onboarding` (and onboarding renders with the new minimal layout, not AppShell)
- ✅ Login form's "Sign in" button submits the password form (Enter key works correctly)
- ✅ Email-verification banner appears for unverified users
- ✅ Member profile Venmo handle renders with single `@`
- ✅ Member profile "Joined" date includes year

---

## Files changed

```
modified:
  src/app/layout.tsx                                 (P2-1)
  src/app/page.tsx                                   (P0-5)
  src/app/terms/page.tsx                             (P0-5)
  src/app/privacy/page.tsx                           (P0-5)
  src/app/(auth)/login/page.tsx                      (P1-3)
  src/app/(auth)/signup/page.tsx                     (P1-3)
  src/app/(auth)/forgot-password/page.tsx            (P2-2)
  src/app/(auth)/reset-password/page.tsx             (P2-2)
  src/app/(app)/billing/page.tsx                     (P1-6)
  src/app/(app)/members/[id]/page.tsx                (P2-4)
  src/app/(app)/bundles/page.tsx                     (P2-10)
  src/app/(app)/bundles/new/page.tsx                 (P2-10)
  src/app/(app)/dashboard/page.tsx                   (P2-10)
  src/app/(app)/year-in-review/page.tsx              (P2-10)
  src/app/join/[code]/page.tsx                       (P0-3)
  src/components/layout/app-shell.tsx                (P1-7)
  src/components/layout/header.tsx                   (P1-1, P2-10)
  src/components/layout/trial-banner.tsx             (P2-10)
  src/components/layout/user-menu.tsx                (P2-10)
  src/components/members/payment-handles.tsx         (P2-3)
  src/components/onboarding/create-household.tsx     (P2-10)
  src/components/schedule/calendar-view.tsx          (P2-10)
  src/components/schedule/create-schedule-dialog.tsx (P2-10)
  src/components/schedule/day-column.tsx             (P2-10)
  src/components/schedule/edit-schedule-dialog.tsx   (P2-10)
  src/components/schedule/week-view.tsx              (P2-10)
  src/lib/hooks/use-auth.ts                          (P0-1)
  src/lib/hooks/use-subscription.ts                  (P1-6)
  src/lib/resend/templates.ts                        (P0-5, P2-11)
  src/lib/utils/push.ts                              (P0-5)
  capacitor.config.ts                                (P0-4)
  package.json + package-lock.json                   (P0-4)
  public/manifest.json                               (P2-5, P2-6)

renamed:
  src/middleware.ts → src/proxy.ts                   (P1-2; also added household-check redirect for P1-5)
  src/app/(app)/onboarding/page.tsx → src/app/onboarding/page.tsx  (P1-4)

added:
  src/app/onboarding/layout.tsx                      (P1-4)
  src/components/layout/verify-email-banner.tsx      (P1-7)
  public/icons/apple-touch-icon.png                  (P2-5; placeholder)
  public/icons/icon-192-maskable.png                 (P2-5; placeholder)
  public/icons/icon-512-maskable.png                 (P2-5; placeholder)

deleted:
  public/logo-dark.jpg                               (P2-7)
  public/logo-icon.jpg                               (P2-7)
  public/logo-light.jpg                              (P2-7)
  public/icons/icon-192.jpg                          (P2-7)
  public/icons/icon-512.jpg                          (P2-7)
```

---

## Remaining work for App Store submission

(Same as before — these are *project* tasks, not code defects.)

1. **Choose & buy a domain.** Set `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_LEGAL_EMAIL`, `NEXT_PUBLIC_PRIVACY_EMAIL`, `SUPPORT_EMAIL` in production env.
2. **Deploy the Next.js app** (Vercel/Render/etc.). Set `CAPACITOR_SERVER_URL` to point at it.
3. **Apple Developer + Google Play accounts** ($99/yr + $25 one-time).
4. **Generate icon set + splash screens** from a 1024×1024 master via `npx @capacitor/assets generate`. Replace the placeholder icons committed today.
5. **Capture screenshots** for `/public/screenshots/` (the new manifest references 4 files).
6. **Run `npx cap add ios && npx cap add android`** from a Mac to bootstrap the native projects. Add `NSCameraUsageDescription`, `NSPhotoLibraryAddUsageDescription`, `NSFaceIDUsageDescription` to Info.plist; `CAMERA` and `POST_NOTIFICATIONS` to AndroidManifest.xml.
7. **Add Sign in with Apple** (required by Apple if you keep Google OAuth).
8. **Decide payments approach** (RevenueCat for iOS IAP, or external-purchase-link entitlement).
9. **Test on real devices**, TestFlight, Play Console internal track.

See `APP_STORE_READINESS.md` for the full checklist.
