# ManyHandz — Google Play Submission Package

Everything needed to get ManyHandz onto Google Play. Package `com.criterial.manyhandz`,
domain `manyhandz.io`. Start with **Internal testing** (no listing/forms required) and graduate to
Closed → Production once the policy items below are settled.

> Generated 2026-06-24 from the actual codebase. Items marked **🔸 DECISION** need a human call.

**Google Play developer ID:** `9183192289764576160` (account **in approval** as of 2026-06-24 — no
app record / publishing until Google clears it).

---

## 0. Who does what

| Step | Owner |
|---|---|
| Create the app in Play Console (Free) | **Nate** (Console UI — API can't) |
| Generate a Play **service-account JSON** (Cloud Console → grant in Play Console) | **Nate** → hand the file path to Claude |
| Content rating (IARC) questionnaire | **Nate** submits (answers below) |
| Data Safety form | **Nate** submits (answers below) |
| Target audience & content | **Nate** (🔸 decision below) |
| Store listing text + screenshots | Claude drafts (below) → Nate pastes |
| Build the signed **AAB** | **Claude** (`eas build -p android --profile production`) |
| `eas submit` to the Internal track | **Claude** (once the service-account JSON exists) |

Internal testing needs **none** of the listing/rating/Data-Safety forms — testers install within
minutes of the AAB uploading. The forms below are for Closed/Production.

---

## 1. Data Safety form

**Encryption in transit:** Yes (all traffic is HTTPS).
**Account deletion:** Yes — in-app (Settings → Delete account) and the privacy policy URL.
**Data deletion URL:** https://manyhandz.io/privacy

| Data type | Collected | Shared (3rd party) | Required | Purpose |
|---|---|---|---|---|
| Name | Yes | No | Yes | Account, household identity |
| Email | Yes | Stripe (billing only) | Yes | Auth, transactional email (Resend) |
| Photos (chore proof, avatars) | Yes | **OpenAI** (AI verification) | Optional | Verify chore completion |
| In-app messages | Yes | No | Optional | Household messaging |
| App activity (chores, points, rewards) | Yes | No | Yes | Core functionality |
| Purchase history (subscription status) | Yes | Stripe | Optional | Billing |
| Push token / device ID | Yes | Expo (push delivery) | Optional | Notifications |
| Payment card numbers | **No** | — | — | Stripe collects directly; app never sees cards |
| Location | No | — | — | — |
| Analytics / crash data | No | — | — | No analytics SDK is bundled |

**Third-party processors (declare as "shared/processed"):** Stripe (billing), OpenAI (photo
verification — *photos leave the device*), Resend (email), Cloudflare R2 (photo storage), Expo (push).
**🔸 DECISION:** confirm each processor's retention with their DPA; "shared" vs "processed on your
behalf" wording depends on contracts. Photos→OpenAI is the one reviewers care about — be explicit.

---

## 2. Permissions

| Permission | Source | Used in prod? | Justification |
|---|---|---|---|
| `CAMERA` | expo-image-picker | ✅ Yes | Take before/after chore photos |
| Photo access (`READ_MEDIA_IMAGES`) | expo-image-picker | ✅ Yes | Attach chore proof + avatars |
| `POST_NOTIFICATIONS` | expo-notifications | ✅ Yes | Chore reminders, approval alerts |
| `INTERNET` | (default) | ✅ Yes | Sync with the server |
| `READ_CALENDAR` / `WRITE_CALENDAR` | expo-calendar plugin | ❌ **No** | **REMOVE — dead** |
| `USE_BIOMETRIC` / `USE_FINGERPRINT` | expo-local-authentication plugin | ❌ **No** | **REMOVE — dead** |

**🔸 Remove before submitting** (no production screen uses them — only the `(dev)` showcase):
in `app.json`, drop the 4 explicit permissions **and** the `expo-calendar` + `expo-local-authentication`
plugins. Re-add if/when the calendar-sync or app-lock features actually ship. Claude can do this in a
build.

---

## 3. Content rating (IARC) — expected **Everyone / PEGI 3**

| Question | Answer |
|---|---|
| Violence | No |
| Sexual content | No |
| Profanity | No |
| Controlled substances | No |
| Gambling | **No** — rewards are app-internal points/allowance, never real-money |
| Users can interact / share content | **Yes** — members exchange messages and share photos |
| Shares user location | No |
| Digital purchases | **Yes** — Stripe subscription |

The "users interact + share content" + "digital purchases" flags are the only non-trivial ones;
they don't raise the age rating but must be declared.

### Target audience — 🔸 IMPORTANT DECISION
Accounts are created by **adults** (parents/housemates); children are *added as members* by a parent
and never sign up themselves. Two paths:
- **Recommended for v1:** set target audience to **13+ / adults**. Avoids Google's **Families policy +
  COPPA** obligations (no ads to kids, stricter data rules) since the actual app users are adults.
- **If you market to families with young kids:** you must opt into the **Designed for Families**
  program and comply fully. More work, more review scrutiny.

Pick 13+ unless marketing specifically targets young children. (No ads are served either way.)

---

## 4. Store listing (draft)

**App name (≤30):** `ManyHandz`

**Short description (≤80):**
`Fair chores, real rewards — the household app that ends the nagging.`

**Full description (≤4000):**
```
ManyHandz turns household chores into a fair, transparent system the whole house actually buys into —
whether you're parents raising responsible kids or housemates splitting the work evenly.

FAIRNESS THAT'S ACTUALLY FAIR
Every chore is effort-weighted, so a 40-minute deep clean counts for more than a 5-minute tidy. A live
balance score shows exactly who's pulling their weight — no more "I always do everything."

DONE MEANS DONE
Snap a before/after photo and ManyHandz' AI checks the work against what "done" looks like — so
approvals are objective, not an argument.

CHORES KIDS ACTUALLY DO
Points, levels, streaks, and a rewards store turn the to-do list into a game. Kids earn their way to
screen time, treats, or allowance — you set the rewards.

BUILT FOR TWO KINDS OF HOUSEHOLDS
• Families — parents assign and approve, kids earn rewards.
• Roommates — equal housemates, auto-rotation, and a settle-up ledger for shared costs.

EVERYTHING INCLUDED
• Auto-rotating chore schedules
• Effort-weighted fairness scoring
• AI photo verification
• Points, levels, streaks & a rewards store
• Settle-Up ledger for shared expenses
• Shared shopping + task lists
• Household messaging
• Reminders that actually land

Many hands make light work. Get the whole house on the same page — fairly.
```

**Screenshot plan** (capture on the emulator/device — phone, portrait, ≥2 required, up to 8):
1. **Home dashboard** — "See today at a glance" (chores due, streak, points, approval queue)
2. **Fairness gauge** — "Know who's really pulling their weight" (the 100/100 balance ring)
3. **Schedule** — "Auto-rotating weekly chore calendar"
4. **Rewards** — "Kids earn their way" (points, levels, rewards store)
5. **Chore detail + photo proof** — "Done means done — AI-verified" (the photo-verify flow)
6. **Chores list** — "Every chore, effort-weighted"

Also needed for the listing: **512×512 app icon** (have it) and a **1024×500 feature graphic** —
✅ generated at `assets/play/feature-graphic.png` (brand-styled placeholder; swap for a designed one
if desired). Neither is required for Internal testing.

---

## 5. Pre-submission checklist
- [x] Package set, target SDK 36 (exceeds Play's API 35 floor)
- [x] Upload keystore minted (`credentials/android/keystore.jks`)
- [x] Privacy policy live (`manyhandz.io/privacy` → 200)
- [ ] 🔸 Remove dead permissions (calendar, biometric) — Claude, in the AAB build
- [ ] 🔸 Target-audience decision (13+ recommended)
- [ ] Nate: create app + service-account JSON
- [ ] Claude: build AAB → `eas submit` to Internal
- [ ] Before **public** launch: resolve Stripe → Google Play Billing (digital-goods policy)
