# ManyHandz — Product Brief (Rebuild Reference)

> **Purpose.** This is a complete, stack-agnostic product brief for **ManyHandz**, a household chore-coordination app. It is written for a team rebuilding the product from scratch on a new tech stack. It describes **what** the product does and **why**, the **domain model** to reproduce, and — critically — the places where the previous implementation's **code disagrees with its own spec or with itself**, so you decide the canonical behavior up front rather than inheriting bugs.
>
> **How this was produced.** Every claim here was verified against the actual source of the previous build (Next.js 16 + Supabase + Stripe PWA), not just its design docs. Where the old docs and the old code conflicted, the **code is treated as ground truth** and the conflict is flagged. Sections marked ⚠️ are decisions you must make.
>
> **Tagline:** *"Many hands make light work."*

---

## Table of Contents

1. [Product Overview & Vision](#1-product-overview--vision)
2. [The Dual-Mode Architecture (the core bet)](#2-the-dual-mode-architecture-the-core-bet)
3. [Roles & Permissions](#3-roles--permissions)
4. [Core Concepts & Glossary](#4-core-concepts--glossary)
5. [Feature Catalog](#5-feature-catalog)
6. [The Points Economy (canonical spec)](#6-the-points-economy-canonical-spec)
7. [Data Model](#7-data-model)
8. [Key End-to-End Flows](#8-key-end-to-end-flows)
9. [Platform, Navigation & Non-Functional](#9-platform-navigation--non-functional)
10. [Integrations](#10-integrations)
11. [⚠️ Known Discrepancies, Dead Code & Decisions to Make](#11-️-known-discrepancies-dead-code--decisions-to-make)
12. [Rebuild Recommendations](#12-rebuild-recommendations)

---

## 1. Product Overview & Vision

**ManyHandz** turns the invisible, frequently-disputed labor of running a household into something **visible, fairly distributed, and accountable**. It serves two very different audiences from one product:

- **Families** — parents administer chores; kids earn points, levels, badges, and rewards; completions can require parent approval.
- **Roommates / couples** — equal peers on an honor system; the hero feature is **fairness scoring** (who is actually pulling their weight).

A third **Office** archetype (manager/colleague) is fully designed but disabled — reserved for the future.

### The three problems it solves
1. **Invisible inequality** — the same person always does the dishes, and nobody can prove it.
2. **Lost accountability** — sticky notes and group texts fall through the cracks.
3. **Forgotten IOUs** — allowances, treats, and favors are promised but never tracked.

### What makes it differentiated
ManyHandz is positioned as the first chore app to unify, in one product:
- **Fairness scoring** — a real-time, *effort-weighted* (difficulty × time) measure of contribution. **This is the killer feature**, especially for roommates.
- **AI-verified photo proof** — before/after photos checked by a vision model against an optional "gold standard" reference photo.
- **Genuinely dual-mode** — family gamification vs roommate minimalism, from one config-driven codebase, not a one-size-fits-all compromise.
- **A real "Settle Up" ledger** — tracks both **money** and **non-monetary** promises (treats, privileges, experiences) as first-class obligations.
- **Auto-rotation** — recurring chores rotate themselves and skip people who are away.

### Target personas
| Persona | Mode | Role | Experience |
|---|---|---|---|
| Parent | Family | `parent` | Full admin; approval queue; sets rewards/goals; manages billing |
| Kid (e.g. 9 yr old) | Family | `kid` | Playful, gamified; earns points toward rewards/goals; completions need approval |
| Roommate (e.g. 28 yr old) | Roommate | `roommate` | Clean, adult, minimal; fairness-first; everyone equal |
| Couple | Roommate | `roommate` | Same as roommates |
| (Future) Manager/Colleague | Office | `manager`/`colleague` | Professional task tracking, no gamification — **disabled today** |

### Positioning copy (from marketing)
- Promise: *"One app. Every household. Real fairness."*
- Eyebrow: *"Now with AI-powered photo verification."*
- App Store subtitle (29 chars): *"Many hands make light work."*
- Category: **Productivity** (primary) or Lifestyle.
- Keywords: `chore, household, family, roommate, chart, allowance, kid, task, reminder, split, fair`.

---

## 2. The Dual-Mode Architecture (the core bet)

> **This is the single most important architectural decision in the product. Preserve it.**

The same codebase behaves like a "kids' chore-gamification app" or an "adult roommate-fairness app" depending on the household's **mode**. Every feature flag, permission, navigation tab, and UI cosmetic is read from a per-mode **config object** — components must *never* branch on raw `role`/`mode` strings. Adding a new mode is meant to be a single config entry.

There are **3 modes**: `family` and `roommate` are live; `office` is fully defined but `enabled: false` (hidden from the create-household picker, no UI surface).

Each mode config declares: `enabled`, label/description/icon, the list of **roles**, the **creator role**, the **default joiner role**, a **16-flag feature set**, **4 UI cosmetic flags**, **per-role nav tabs**, and a **21-flag per-role permission matrix**.

### Feature flags by mode

| Feature flag | Family | Roommate | Office (disabled) |
|---|:---:|:---:|:---:|
| `gamification` | ✅ | ❌ | ❌ |
| `rewards` | ✅ | ❌ | ❌ |
| `goals` | ✅ | ❌ | ❌ |
| `approvalWorkflow` | ✅ | ❌ | ❌ |
| `leaderboard` | ✅ | ❌ | ❌ |
| `photoProofDefault` | ✅ | ❌ | ❌ |
| `fairnessScoring` | ✅ | ✅ | ✅ |
| `paymentHandles` | ✅ | ✅ | ❌ |
| `bonusChallenges` | ✅ | ✅ | ❌ |
| `pointGifting` | ✅ | ✅ | ❌ |
| `weeklyReportCard` | ✅ | ✅ | ✅ |
| `birthdaySystem` | ✅ | ✅ | ❌ |
| `accentColors` | ✅ | ✅ | ✅ |
| `headToHead` (competitions) | ✅ | ✅ | ❌ |
| `aiVerification` | ✅ | ✅ | ❌ |
| `speedBonus` | ✅ | ✅ | ❌ |

### UI cosmetics by mode

| UI flag | Family | Roommate / Office |
|---|---|---|
| `difficultyDisplay` | `stars` (1–5 ★) | `text` (Easy/Medium/Hard) |
| `completionAnimation` | `confetti` | `checkmark` |
| `tonePlayful` | `true` | `false` |
| `showPointsProminent` | `true` | `false` |

### Roles by mode
- **Family:** `parent` (creator, full admin), `kid` (default joiner, restricted).
- **Roommate:** `roommate` only (creator = joiner = roommate; everyone equal). The creator's only special privilege is being the Stripe billing owner.
- **Office (disabled):** `manager` (creator), `colleague` (default joiner).

Mode is set once at household creation and is effectively **immutable** in the UI (Settings shows it as a read-only badge).

---

## 3. Roles & Permissions

Permissions are a 21-flag matrix per (mode, role). `isAdmin` is derived purely as `canEditHouseholdSettings`.

### Family — parent vs kid

| Permission | Parent | Kid |
|---|:---:|:---:|
| Create / Edit / Delete chores | ✅ | ❌ |
| Create rotations | ✅ | ❌ |
| Assign chores | ✅ | ❌ |
| View all assignments | ✅ | ✅ |
| Mark own complete | ✅ | ✅ (→ approval) |
| Submit photo proof | ✅ | ✅ |
| Approve completions | ✅ | ❌ |
| Create rewards | ✅ | ❌ |
| Redeem rewards | ✅ | ✅ (→ approval) |
| Create goals for anyone | ✅ | ❌ (self only) |
| Contribute to own goals | ✅ | ✅ |
| Invite members / Change roles | ✅ | ❌ |
| Edit household settings | ✅ | ❌ |
| Access billing | ✅ | ❌ |
| Create challenges | ✅ | ❌ |
| Gift points | ✅ | ✅\* |
| Create competitions | ✅ | ✅\* |
| Configure AI | ✅ | ❌ |

\* **Two-layer gating:** the mode config grants kids `canGiftPoints` and `canCreateCompetitions` at the base level, but they are **also** gated by household-level toggles (`allow_kid_gifting` default **true**, `allow_kid_competitions` default **true**, `allow_kid_challenges` default **false**). The household toggle is authoritative at runtime. **The rebuild must wire both layers.**

### Roommate — single role
Roommate can do everything *except* `approveCompletions`, `createRewards`, `redeemRewards`, `createGoalsForAnyone`, `contributeToOwnGoals` (rewards/goals/approvals don't exist in roommate mode). All roommates can create/edit/delete chores, create rotations, assign, invite, change roles, edit settings, access billing, configure AI, create challenges/competitions, and gift points.

### Office (disabled) — manager vs colleague
Manager: full admin minus gamification/approvals/rewards/goals/challenges/competitions/gifting/AI. Colleague: create+edit chores (not delete), mark own complete, submit photo — nothing administrative.

> ⚠️ **Approver inconsistency (must reconcile):** the codebase defines "who can approve" **three different ways** — the assignment-approval API allows `parent`/`manager`; the snooze-approval API allows `parent`/`manager`/`roommate`; the approval-queue UI gates on `isAdmin` (= `canEditHouseholdSettings`). Pick one canonical rule.

---

## 4. Core Concepts & Glossary

| Term | Definition |
|---|---|
| **Household** | The top-level tenant/group. Has a `mode` and a large set of policy flags. Owns the entire content graph (cascading deletes). |
| **Profile** | One row per authenticated user. Identity + Stripe customer linkage. A user may belong to many households. |
| **Member** | A user's per-household identity (one `members` row per household+user). Carries role, points, XP, streaks, payment handles, away status, allowance config. **All in-app actors are members, not users.** |
| **Chore** | A reusable *template/definition* (the "what"): name, difficulty 1–5, estimated minutes, category, checklist, optional reference photo, AI/approval flags. |
| **Assignment** | A *dated instance* of a chore tied to one member with a due date and a status — the core unit of work. |
| **Completion** | The event recording that an assignment was done. **Inserting a completion is what drives the entire points/XP/streak/achievement economy** (via a DB trigger). |
| **Rotation Group** | An automatic recurring rotation of one chore among an ordered set of members (round-robin or fixed) at a frequency. |
| **Points (`points_balance`)** | **Spendable** currency — earned by completing chores; spent on rewards, goals, gifts, competition stakes. |
| **XP (`total_xp`)** | **Lifetime, never-decreasing** score — drives levels/titles and the leaderboard. (Points and XP are two separate pools; the old docs sometimes conflate them.) |
| **Level / Title** | 1–50, derived from cumulative XP, with rank titles (Rookie → Hall of Fame). |
| **Badge** | An achievement. Two kinds: a global catalog of system badges, and household-defined custom badges. |
| **Reward** | A point-priced perk a (family) parent defines; kids redeem with points. |
| **Goal** | A savings target a member funds with points (optionally with a dollar value). |
| **Challenge** | A time-boxed, household-wide bonus event (double points / complete-N / no-overdue / custom). |
| **Competition** | A 1-v-1 head-to-head duel between two members with optional point stakes. |
| **Fairness score** | Effort-weighted measure of how evenly work is distributed. |
| **Settlement** | A who-owes-whom ledger entry — money or non-monetary (treat/gift/privilege/experience/custom). |
| **Quick task** | A lightweight one-off to-do with no points/gamification. |

---

## 5. Feature Catalog

Each subsection lists the user-facing behavior, key rules, and exact numbers. Statuses/enums are named explicitly. ⚠️ marks behavior you must decide on (full list in §11).

### 5.1 Authentication & Onboarding

**Auth methods (Supabase-backed):**
- **Email + password** (signup requires min 8-char password; a cosmetic 0–5 strength meter that does *not* block submit).
- **Google OAuth** (one-tap; requires the provider enabled in the auth project).
- **WebAuthn passkeys** — custom implementation; register/login "options" + "verify" routes; passkey login exchanges a server-minted magic-link token for a real session. UI only shows if the browser supports WebAuthn.
- **Password reset** and **email verification** (standard flows). Email verification is currently **not** required to proceed into onboarding.

**Security details to preserve:** open-redirect protection (redirect targets must be relative); passkey login derives the user server-side from the stored credential (anti-hijack); email-enumeration protection (generic error for unknown user vs no-passkey); WebAuthn challenges expire in 5 minutes.

**Onboarding wizard** (post-signup): 4 steps for admins, 3 for joiners.
1. **Create or Join** — create (name + mode picker: Family/Roommate) or join via an 8-char invite code.
2. **Chore presets** (admins only) — bulk-add starter chores from the template library.
3. **Profile** — display name, birthday, bio, favorite color (avatar, payment handles).
4. **Trial activation** — celebrates the 14-day free trial; referral-code entry.

Creating a household also creates a `subscriptions` row (`status='trialing'`, `trial_end = now + 14 days`) and auto-generates a referral code. Role on join: family creator → `parent`, family joiner → `kid` (parent can promote), roommate → `roommate`.

**Join flows:** `/join/[code]` deep link (case-insensitive lookup), shareable link, and QR code. Unauthenticated users see the household name/mode, sign up/in, then auto-join.

### 5.2 Households, Members, Profiles, Settings, Vacation

**Household settings** (admin) include: name, mode badge (read-only), regenerate invite code, `require_photo_proof`, `require_approval`, leaderboard visibility, **kid permission toggles** (`allow_kid_gifting`, `allow_kid_challenges`, `allow_kid_competitions`, `max_kid_competition_stakes` default 50), **AI verification settings** (master toggle, provider, thresholds, monthly cost cap), custom categories, custom badges, referral program, data export, timezone (default `America/New_York`), delete household.

**Member profiles:** display name, avatar (uploaded to a public `avatars` bucket; default = initials on favorite-color background), bio, birthday (age auto-computed), favorite color (12-color palette), payment handles (Venmo/PayPal/Cash App/Apple Cash), points/level/streak stats, contribution chart, recent activity.

**Vacation / Away mode:** set `away_until` + reason. While away: rotation skips the member, no streak penalty, "Away" badge, excluded from fairness. Auto-clears when the date passes.

**Multi-household switching:** header dropdown (shown only when a user has >1 household); switching reloads all data scoped to the active household (persisted client-side).

**Other profile/settings items:** mute-celebrations toggle, passkey management (list/add/rename/delete), notification preferences (per-category + push/email channel toggles + reminder time), in-app feedback form (uploads a screenshot to a `feedback` bucket and is intended to email support).

### 5.3 Chores, Templates & Categories

**Chore fields:** name (≤100 chars), description (≤500), category, single Lucide icon, **difficulty 1–5 (default 3)**, **estimated minutes (DB default 15; form slider 5–120 step 5; validation allows 1–480)**, ordered **checklist** of `{label, required}` steps (stored as JSON), optional **reference photo** ("The Goal"), **`ai_verification_enabled` (default false)**, **`requires_approval` (default true)**. Delete is a **soft delete** (`is_active=false`).

**Template library:** a hardcoded starter set — **36 templates across 8 categories**: Kitchen 6, Bathroom 5, Living Areas 5, Bedroom 4, Outdoor 5, Laundry 4, **Pets 4, General 3**. Each template carries difficulty, minutes, icon, and a checklist. *(Note: the old spec said Pets 5 / General 4 — the code counts above are authoritative.)*

**Default categories (8, global):** Kitchen, Bathroom, Living Areas, Bedroom, Outdoor, Laundry, Pets, General — each with a fixed icon + color. Households can add custom categories.

> ⚠️ **Known bug:** the chore form writes the category **name** into the `category_id` (a UUID FK), so form-based category assignment is effectively broken. The reference-photo upload button in the chore form is a non-functional stub, so `reference_photo_url` can't be set through the create UI. Both must be fixed in the rebuild.

### 5.4 Assignment Lifecycle, Timer, Photo Proof & Approvals

**Assignment statuses:** `pending` → `in_progress` → `completed` | `overdue` | `skipped` | `pending_review` (kid completion awaiting approval) | `snoozed_pending_approval`.

**Lifecycle:**
1. Assignment created (`pending`) by a one-off schedule, rotation pre-generation, or the rotation cron.
2. Member opens it → **Start Timer** (`in_progress`) → checks off checklist steps (progress %) → **Mark Done** → **Completion modal**.
3. On submit: if approval needed → assignment `pending_review` + completion `pending_approval`; else → assignment `completed` + completion `approved`.
4. Past-due `pending`/`in_progress` assignments are flipped to `overdue` by an hourly cron (the UI also shows a computed "overdue" badge in real time before the cron runs).

**Timer & speed bonus:** a client-side stopwatch (persisted per assignment) with pause/resume. On completion, elapsed whole minutes become `actual_minutes`, feeding a speed bonus (must be ≥ 2 minutes to qualify; capped at 50% of base). The timer is optional and does **not** sync across devices.

**Completion & photo proof:** the completion modal optionally attaches a **before** photo and an **after** photo, notes, and shows a **live points preview**. If both photos are present and AI is enabled (per-chore **and** per-household), AI verification fires. A draggable before/after comparison slider is shown on the detail page.

**Approval queue (admin only):** lists `pending_approval` completions, oldest first. Approve → completion `approved`, assignment `completed`. Reject → reason (≤300 chars) required → completion `rejected`, assignment back to `in_progress` (a "Try Again" redo loop).

> ⚠️ **Approval does not gate points today.** The completion-insert DB trigger awards points *immediately* on insert (even for `pending_approval`), so a later rejection does not claw points back. Decide whether approval should be **pre-award** (hold points until approved — recommended) or **post-award** (cosmetic). Also: two photo pipelines exist (inline base64 data-URLs in the completion modal — *currently used*; vs compressed uploads to the `proof-photos` bucket — *currently unused*); pick one (the bucket path is recommended).

### 5.5 Scheduling, Rotation, Swaps, Snooze & Overdue

**Scheduling:** a multi-step "Create Schedule" dialog: pick a chore → choose **One-Time** (assignee + due date/time → single `pending` assignment) or **Recurring** (frequency + rotation type + ordered members + start date → a rotation group + pre-generated assignments). A calendar page shows **week** (Monday-start) / **month** views with member/category/status filters and a day panel with quick **Done**/**Skip**.

**Recurrence frequencies & look-ahead pre-generation:** daily (interval 1 day, ~4 weeks ahead), weekly (7 days, 8 weeks), biweekly (14 days, 12 weeks), monthly (30-day approximation, 16 weeks).

**Auto-rotation algorithm:**
- `fixed` → always `member_order[0]`; if that member is away, no one is assigned.
- `round_robin` → advance from `current_index + 1`, wrapping, skipping away members; if all away, skip the period (index unchanged).
- Away = `is_active` member with `away_until ≥ today`.
- The rotate cron only advances **exactly on interval-boundary days** (`diffDays % interval == 0`), so near-term work comes from pre-generation and only longer-term work depends on the (fragile) boundary cron.

**Chore swaps:** a member proposes a **mutual swap** (trade two assignments) or a **free swap** (hand off one assignment); the target accepts/declines. Accept swaps `assigned_to`. *(Backend + hook exist; no user-facing swap UI ships today — must be built.)*

**Snooze / postpone (approval-gated):** a request to change an assignment's due date; preserves `original_due_date`, increments `snooze_count`, records reason (≤300 chars). Family: parents approve/deny; roommate: any member. *(No request-creation UI ships today.)*

> ⚠️ **Snooze issues:** (a) the spec's guardrails — "max 3 snoozes, max 7 days past original" — are **not implemented anywhere**; (b) there's a **double-increment bug** (both the API and a DB trigger add 1 to `snooze_count` on approval); (c) the `snoozed_pending_approval` assignment status exists and renders but is never actually set.

**Overdue handling:** hourly cron flips past-due assignments to `overdue` and pushes a notification; a DB trigger resets the member's `current_streak` to 0 and writes an activity entry. Overdue uses **date only**, not time (a same-day task with a passed due-time isn't overdue until the next day).

### 5.6 Points, XP, Levels & Streaks

See **§6** for the full canonical economy. Summary: completing an approved chore mints **points** (spendable `points_balance`) and **XP** (lifetime `total_xp`). XP drives **50 levels** with titles (Rookie 1–4, Helper 5–9, Contributor 10–14, Household Pro 15–19, Chore Master 20–29, Household Legend 30–39, ManyHandz Elite 40–49, Hall of Fame 50+). Streaks: +1 per consecutive day with an approved completion; reset to 0 on overdue.

### 5.7 Badges, Custom Badges & Milestones

**Achievement catalog:** 45–47 system badges across 10 categories (beginner, consistency, points, skill, competition, ai, fairness, level, goal, social), shown as an earned/locked grid. Example thresholds: streaks (on_a_roll 3d, week_warrior 7d, streak_master 30d, iron_will 60d, legendary 100d), points (century_club 100, household_hero 500, point_machine 1000, the_one_percent 5000), levels (5/10/25/50), AI (ai_approved 10, perfectionist 5 perfect scores, machine_verified 50), fairness (fairness_champion 4 wks, balance_keeper 8 wks), social (philanthropist 500 gifted, most_loved 3+ gifters).

> ⚠️ **The catalog is almost entirely unearnable today.** The only code that awards system badges is a DB trigger inserting keys `first_chore`, `streak_7`, `streak_30` — **none of which match catalog keys**, so trigger awards never render and catalog badges never unlock. **Decide:** wire the full catalog to real award logic, or keep a small real set.

**Custom badges (these DO work):** admins define household-specific badges (name, icon, color, criteria). Criteria types: `chore_count`, `category_count`, `streak`, `speed_bonus_count`, `points_total` (compares against **lifetime XP**, not spendable balance), `manual`. The completion trigger auto-awards non-manual badges when criteria are met; manual award/revoke is supported.

**Household milestones** (collective, not per-member): completion-count tiers (100, 500, 1000, 5000, 10000 — auto-recorded by the trigger). Five "special" milestones (zero-overdue week, full house, perfect month, 1-year, 3-year) are catalogued but have **no detection logic implemented**.

### 5.8 Rewards, Redemption & Leaderboard

**Rewards (Family only):** parents publish a catalog of point-priced perks. A kid redeems via an **atomic RPC** (`redeem_reward`) that locks the member row, requires sufficient balance, deducts immediately, and inserts a redemption with status `pending`. Parent **approves** (`approved`) or **rejects** (`rejected` → an RPC refunds the points). In family mode a redemption also auto-creates a **settlement** so a parent fulfills the real-world reward.

**Leaderboard (Family only):** ranks members by **lifetime XP** (not spendable points), with crown/medals for the top 3 and a streak flame. *(The This Week/This Month/All Time period filter is cosmetic — ranking always uses lifetime XP.)*

### 5.9 Goals

**Goals (Family only):** a member sets a point-savings target (optionally with a dollar `monetary_value`, stored in **cents**). Kid-created goals start `pending_approval` (parent approves → `active`, or rejects → `canceled`); parent-created goals start `active`. Members contribute points via an **atomic RPC** (`contribute_to_goal`) that deducts the contributor's balance, adds to the goal, and auto-sets `completed` at target. **Auto-contribute:** a chore completion can auto-deposit a configurable percentage (`0/10/25/50/75/100`) into each of the member's active auto-contribute goals.

Goal suggestions (with point + dollar values): New Video Game 500/$69.99, Movie Night 200/$25, New Book 150/$15.99, Art Supplies 300/$39.99, Extra Screen Time 100, Sleepover 250.

> ⚠️ Two gaps: (a) the spec's "Fulfill Goal → creates a `goal_payout` settlement" flow **isn't implemented** (completion only flips status); (b) `contribute_to_goal` always records source `manual` regardless of the param; (c) the goals page lets the **current user** spend *their* points on *another* member's goal — confirm whether cross-member funding is intended.

### 5.10 Challenges & Competitions

**Bonus challenges** (household-wide, time-boxed): types `double_points` (multiplier 1.5/2/3×), `complete_count` (N completions in window), `no_overdue` (zero overdue in window), `custom`. Duration presets 1/2/3/5/7 days. An hourly cron resolves them at `ends_at`; on success, **all active members** receive `bonus_points`. Only one `double_points` challenge multiplies points at a time. *(The challenge card's complete_count progress bar is hardcoded to 0 — no live tracking.)*

**Head-to-head competitions** (1-v-1): types `most_points`, `most_completions`, `first_to_target`, `specific_chore_race`. Optional **point stakes** + a real-world wager note. Flow: created `pending` → only the opponent can accept (`active`) or decline → the completion trigger advances each member's progress while active → an hourly cron resolves at `ends_at` (winner by higher progress; ties = no transfer) → stakes transferred (winner +stakes, loser −stakes floored at 0). Duration options 1/3/5/7/14 days. Kid wagers capped by `max_kid_competition_stakes` (default 50).

> ⚠️ Stakes are **not** a true escrow — points are only moved at resolution, not held at accept time, so a loser who already spent their points pays less than wagered (floored at 0). Decide whether to escrow at accept.

### 5.11 Fairness, Health Score, Reports, Year-in-Review, Dashboard & Activity Feed

**Fairness** (see §6 for the formula): per-member share vs ideal (`100 / member count`) with status bands (≤5pp balanced/green, ≤15pp slightly-off/amber, >15pp significantly-off), a household 0–100 balance score with labels (≥90 Perfectly Balanced, ≥75 Well Balanced, ≥60 Slightly Uneven, ≥40 Needs Attention, else Significantly Uneven), a zero-overdue household streak, a contribution pie, an 8-week trend, a detailed stats table, and a "most avoided" list (top-5 chores by overdue+skipped over 90 days). Period selector (this/last week/month). Away/Birthday-Pass members are excluded.

**Household health score:** a single 0–100 number recomputed weekly by the report cron: `round(completionRate×0.5 + fairnessScore×0.3 + streakHealth×0.2)` (streakHealth = `min(100, avgStreak/7 × 100)`), stored on the household. ⚠️ A richer 5-component gauge UI (completion/fairness/streak/overdue/engagement, each 0–20) exists but is **orphaned** (never rendered; `overdue`/`engagement` are never computed). Decide which model to ship.

**Weekly report cards:** a weekly cron generates a household report with per-member completion ratios, **letter grades** (A+ ≥97 … F <60), points, streaks, fairness deltas, star chore, and an **MVP** (most points that week). The Reports page shows the current week, MVP, per-member cards, an 8-week trend, and history (last 12). Family mode is playful (grades); roommate mode is clean stats. ⚠️ The cron writes `report_data` with different key names than the UI reads — reconcile the shape.

**Year-in-Review:** a swipeable, auto-playing **7-slide** annual recap (total completed/points, MVP, longest streak + most consistent, top/avoided chores, busiest/slowest month, competitions/challenges/gifts), shareable. Speed-demon stat needs ≥3 timed completions. *(API supports `?year=` but there's no past-year picker UI.)*

**Dashboard:** mode/role-aware. Common: greeting (time-of-day, playful tone in family), trial banner, quick stats (due today / completed / streak / points — points column only if gamification), today's assignments, overdue section, activity feed (10 recent). Parent: approval-queue card, FAB to add chore. Kid: Level/Streak hero, goals as progress rings, simplified cards. Roommate: fairness mini-widget, clean cards, FAB. *(Spec describes many more dashboard widgets — birthday/announcement banners, challenge/competition "VS" cards, settle-up/shopping/poll widgets — several of which are unwired today; see §11.)*

**Activity feed & reactions:** an append-only household event stream (35 action types — completions, level-ups, achievements, challenge/competition results, gifts, goals, polls, birthdays, settlements, etc.), most written by DB triggers/cron. Members toggle emoji reactions 👍 ❤️ 🔥 ⭐ 👏 (stored as a JSON map emoji→memberIds). **This is the only collaboration feature actually wired into a screen.** ⚠️ Reaction writes are last-write-wins on a JSON blob — a rebuild should normalize reactions into a table.

### 5.12 Settle-Up, Allowances, Payment Links, Shopping & Bundles

**Settle-Up ledger:** tracks who-owes-whom for **money and non-money** obligations. `payout_type`: `money`, `treat`, `gift`, `privilege`, `experience`, `custom`. Balance **nets only money** per member-pair; non-money is counted by direction. Settlements are created **automatically** (`source_type`: `goal_payout`, `competition`, `reward_redemption`, `allowance`) or **manually** (IOUs, parent promises). Status: `pending` → `settled` | `forgiven` | `declined`. The debtor (`from_member`) can mark settled; the creditor (`to_member`) or a parent can **forgive**. Filter tabs: All / Money / Treats / Privileges / Experiences.

**Allowances (Family):** per-kid config (enable, payout type, amount/description, threshold % — default **80**). A weekly cron auto-creates an allowance settlement (from the first parent/manager) when the kid meets the threshold; idempotent per week; silently skipped if no parent/manager exists.

**Payment deep-links** (money settlements only):
- Venmo: `venmo://paycharge?txn=pay&recipients={handle}&amount={amount}&note={note}` (the only true app scheme)
- PayPal: `https://paypal.me/{handle}/{amount}`
- Cash App: `https://cash.app/${handle}/{amount}`
- Apple Cash: **no deep link** (display phone / "send via iMessage")

**Shopping lists:** multiple lists per household (a default "Groceries" list is auto-created when the first member joins). Quick-add with **13-category keyword auto-categorization** (produce, dairy, meat, bakery, frozen, pantry, beverages, snacks, cleaning, household, personal, pets, other), check-off, archive. **Recurring items** (auto-add staples weekly via cron) exist in the data model but have **no UI to create the rules**. ⚠️ Despite the spec, shopping has **no realtime sync** today.

**Chore bundles:** a named grouping of chores; assigning a bundle creates one `pending` assignment per chore. Soft-delete via `is_active`. ⚠️ The advertised "+10% bundle-completion bonus" is **not implemented** (no bonus field, no completion trigger).

**Data export:** `GET /api/export` returns **CSV or JSON** for completions, fairness, or a full backup (`type=full` is admin-only; rate-limited 10/hr). ⚠️ Marketing advertises **PDF** export — not implemented.

### 5.13 Billing, Monetization & Referral

**Pricing:** a single paid tier gating the whole app. **Monthly $9.99 (999¢)** or **Annual $99.99 (9999¢, ~17% cheaper / "Best Value")**, behind a **14-day, no-credit-card free trial**. After the trial without subscribing, the household becomes **read-only** (can view everything; cannot create/complete/redeem).

**Read-only enforcement is at the DATABASE (RLS) layer** via `household_has_active_subscription()`, applied as an INSERT check on ~17 content tables — not just in the UI. Trial "active" is computed from **both** `status='trialing'` **and** `trial_end > now`, so it behaves correctly even before a webhook updates the row.

**Stripe flows:** Checkout (monthly/annual price), Customer Portal (manage), and a signature-verified **webhook** that handles `checkout.session.completed` (→active), `customer.subscription.updated` (→status), `customer.subscription.deleted` (→canceled), `invoice.payment_failed` (→past_due). Webhook writes use a service-role client. Subscription statuses: `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `incomplete` (one row per user, tied to a household).

> ⚠️ Webhook does **not** handle `invoice.payment_succeeded` (spec lists it). Checkout price IDs are env-validated placeholders that will be rejected until real IDs are set.

**Referral program:** each household auto-generates one shareable code (copy/link/QR), `max_uses` default 10. Both households are *meant* to get a free month. ⚠️ **The credit is never actually applied** — the route only creates/reads codes and stats; no Stripe credit logic exists, and `*_credit_applied` flags are never flipped. Code format also disagrees: spec says `MANYHANDZ-XXXX`, code produces `MH-XXXXXXXX`.

### 5.14 AI Features

All AI runs server-side. Provider is per-household (`openai` default, or `anthropic`).

- **AI photo verification** (the marquee AI feature): when a completion has before+after photos and the chore + household both have AI enabled, the photos (plus optional reference) go to a vision model. **OpenAI uses `gpt-4o`; Anthropic uses `claude-sonnet-4-20250514`.** Returns confidence (0–100), `task_completed`, `reference_match_score`, and reasoning. Decision: **auto-approve** if confidence ≥ approveThreshold **and** task_completed; **auto-reject** if confidence < rejectThreshold **or** (!task_completed and confidence < 50); else **flag for review**. Result sets completion status `ai_approved` / `rejected` / `pending_approval`. **Image fetching is SSRF-restricted to Supabase hosts, 10 MB cap.** Per-call cost tracked; **monthly cost cap default 500¢ ($5)** per household → HTTP 429 when exceeded. ⚠️ **Threshold mismatch:** DB defaults are **85 / 40** but the route's hardcoded fallbacks are **80 / 30** — pick one (recommend 85/40).
- **AI smart suggestions:** a weekly job (intended) has `gpt-4o` analyze the last 14 days and return 3–5 actionable suggestions for a dashboard "AI Insights" card.
- **AI photo-to-task** (`gpt-4o` vision): messy room → chore+subtasks; empty shelf → shopping items; receipt → line items. ⚠️ **Backend exists but has no caller — unwired.**
- **AI parse-shared-text** (`gpt-4o`): classifies shared text/URL into shopping items / quick tasks / chores (input capped 10,000 chars). ⚠️ **Unwired** — the `/share-intake` page uses manual forms, never this route.

> ⚠️ Only `ai_verifications` calls count against the monthly cost cap; suggestion/photo/parse calls are not cost-logged.

### 5.15 Collaboration: Comments, Polls, Announcements

- **Comments** on chore assignments: a threaded discussion per assignment (≤500 chars). ⚠️ Implemented **twice** — a reusable realtime hook/components (with 500-char guard, optimistic insert, 50-comment limit) that is **never imported**, and an inline version on the assignment page (no realtime, no limit) that is **what actually ships**. Consolidate to one.
- **Polls:** create a 2–6 option poll, single/multiple choice, optional anonymous, optional auto-close; results as bars/charts with winner/tie highlighting. Toggle-vote behavior. ⚠️ **Backend-complete but zero UI entry points** — must be wired.
- **Announcements:** pinned household notices with priority (`normal`/`important`/`urgent`) and optional expiry; soft-delete by un-pinning. ⚠️ **Backend-only (no UI imports it)** — must be built.

### 5.16 Notifications: Push, Email, In-App & Service Worker

- **Web push (VAPID):** per-user subscriptions keyed by endpoint; fan-out to a user or to all active household members (with actor exclusion); dead subscriptions auto-pruned on send failure. ⚠️ Only **two** cron jobs actually send pushes today — **overdue** and **birthday**. None of the rich event pushes (approvals, completions, comments, etc.) are sent.
- **Service worker (Serwist):** offline precache + runtime cache; renders push notifications; **notification action buttons** with deep links + background API calls (`approve`, `start_now`, `postpone`, `approve_snooze`, `deny_snooze`, `vote_now`); **Web Share Target** (receive shared text/URL/photos → `/share-intake`). ⚠️ The action buttons are aspirational — nothing constructs push payloads containing them. The share-intake page reads shared content from URL query params and never consumes the SW-cached shared **photos**.
- **Email (Resend):** **8** branded dark-themed HTML templates exist (welcome, weekly digest, approval request, overdue alert, trial-ending, payment-failed, goal-completed). ⚠️ **`resend.emails.send(...)` is never called anywhere — all 8 templates are dead code.** The rebuild must wire sends to events.
- **In-app notification bell:** a header popover that is a **permanent empty-state placeholder** (no data source).
- **Supabase DB webhook fan-out** (`/api/webhooks/supabase`): HMAC-verified but a **verified no-op** (both branches empty; real-time handling moved to cron + triggers).

---

## 6. The Points Economy (canonical spec)

> ⚠️ **Most important reconciliation in the whole product.** Points are computed in **three divergent places** that disagree. **The DB completion-insert trigger is what actually persists points and updates the member**, and it uses a *different, simpler* formula than the rich client utility. The displayed points preview will not match what is awarded. **You must choose ONE canonical engine.**

### The three implementations
1. **`points.ts` (the "designed", rich formula — client utility):**
   - `base = ceil(difficulty × estimatedMinutes / 15)`
   - `streakBonus = ceil(base × min(streak × 0.10, 0.50))` — +10%/day, cap +50%
   - `speedBonus = min(floor((est − actual)/est × base × 0.5), ceil(base × 0.5))` — cap 50%; 0 if `actual ≥ est` or `actual < 2` min
   - `photoBonus = 3` (both photos) | `1` (either) | `0`
   - `earlyBonus = 2` (completed before due date)
   - `total = ceil((base + streakBonus + speedBonus) × max(1, challengeMultiplier)) + photoBonus + earlyBonus` (multiplier applies to performance points only, **not** flat photo/early bonuses)
2. **Completion-modal preview:** `base + streak + speed + photo` — **no** early bonus, **no** multiplier (so even the preview disagrees with `points.ts`).
3. **DB trigger `handle_completion_insert` (AUTHORITATIVE today):** `points_earned = round(difficulty × 10 × activeDoublePointsMultiplier) + speed_bonus`. **Base is `difficulty × 10`**, only the `double_points` challenge multiplier applies, and **streak/photo/early bonuses are silently discarded.**

### Recommendation
Pick the `points.ts` formula as canonical (it's the richer, intended design) and implement it **once, server-side and atomically**, so the preview, the award, fairness, and leveling all agree. Whatever you choose, define it in **one** place.

### Levels & XP (verified identical in app code AND the DB `calculate_level` function — keep them in sync)
Cumulative XP thresholds: **L1:0, L2:50, L3:120, L4:200, L5:350, L6:500, L7:700, L8:1000, L9:1300, L10:1700, L15:4000, L20:8000, L25:14000, L30:22000, L40:45000, L50:80000** (intermediate levels linearly interpolated; MAX_LEVEL 50). Titles: 1–4 Rookie, 5–9 Helper, 10–14 Contributor, 15–19 Household Pro, 20–29 Chore Master, 30–39 Household Legend, 40–49 ManyHandz Elite, 50+ Hall of Fame.

### Streaks (DB trigger)
`current_streak` +1 if the prior approved completion was *yesterday*, unchanged if *today*, else reset to 1; `longest_streak = max(longest, current)`. Overdue resets `current_streak` to 0 (separate trigger).

### Fairness (verified `fairness.ts` + DB `get_fairness_scores`)
- Per-member "points" for fairness = sum of `points_earned + speed_bonus` over **approved/ai_approved** completions in the period (effort-weighted, not task-count).
- `idealShare = 100 / memberCount`; `percentage = member.points / total × 100` (or idealShare when total = 0); `deviation = percentage − idealShare`.
- Status bands by `abs(deviation)`: ≤5 balanced, ≤15 slightly_off, >15 significantly_off.
- Household score = `clamp(round(100 − avgAbsDeviation), 0, 100)`. Single-member household = 100.

### Letter grades (reports — same thresholds used on both a 0–1 ratio and a 0–100 rate; pass the right scale)
A+ ≥97, A ≥93, A- ≥90, B+ ≥87, B ≥83, B- ≥80, C+ ≥77, C ≥73, C- ≥70, D+ ≥67, D ≥63, D- ≥60, else F.

---

## 7. Data Model

**40 application tables**, all multi-tenant by household, all RLS-protected. The model must be reproduced faithfully (you can change the storage engine, but keep the relationships, statuses, and integrity rules).

### Core entity graph
`profiles` (1 per user) → `members` (1 per household+user, the in-app actor) → `households` own everything via cascading `household_id` FKs. `chores` (templates) are grouped by `chore_categories`; a `rotation_group` mints `assignments` (dated instances); finishing an assignment inserts a `completion`, whose **BEFORE-INSERT trigger drives the entire economy** (points, XP, level, streak, activity feed, achievements, milestones, competition progress, custom badges, goal auto-contributions). Members spend points three ways — `reward_redemptions`, `goal_contributions`, `point_gifts` — each via an atomic RPC. `settlements` form the who-owes-whom ledger. `subscriptions` gate content creation via RLS.

### Table inventory (purpose)
| Table | Purpose |
|---|---|
| `profiles` | One per auth user; identity + Stripe customer id. Auto-created by trigger. |
| `webauthn_credentials` / `webauthn_challenges` | Passkeys + ephemeral challenge nonces (5-min expiry). |
| `households` | Tenant + all policy/config flags (mode, invite_code, timezone, require_approval/photo_proof, kid toggles, AI settings, health_score). |
| `members` | Per-household identity: role, `points_balance`, `total_xp`, `current_level`, streaks, payment handles, away status, allowance config, favorite_color. Unique (household_id, user_id). |
| `chore_categories` | 8 global defaults (household_id NULL) + custom. |
| `chores` | Reusable chore definitions. `difficulty × 10` is the DB base-points value. |
| `rotation_groups` | Recurring rotation config (member_order, current_index, rotation_type, frequency, start_date). |
| `assignments` | Dated chore instances (assigned_to, due_date, status, checklist_progress, snooze_count, original_due_date). |
| `completions` | Done events (photos, notes, points_earned, speed_bonus, actual_minutes, approval fields, status). Economy trigger. |
| `rewards` / `reward_redemptions` | Reward catalog + redemption lifecycle (pending/approved/rejected). |
| `achievements` | System badges earned (unique per member+badge_key). |
| `custom_badges` / `custom_badge_awards` | Household-defined badges + awards. |
| `household_milestones` | Collective milestones (unique per household+key). |
| `goals` / `goal_contributions` | Savings goals + contribution ledger. |
| `bonus_challenges` | Time-boxed household challenges. |
| `competitions` | 1-v-1 head-to-head duels with stakes. |
| `point_gifts` | Member-to-member point gifts. |
| `settlements` | Money + non-money who-owes-whom ledger. |
| `shopping_lists` / `shopping_items` | Shared lists + items (13-category enum, recurring_items rules). |
| `quick_tasks` | Lightweight one-off to-dos. |
| `assignment_comments` | Threaded comments per assignment (≤500 chars). |
| `household_polls` | 2–6 option polls with JSON vote tallies. |
| `announcements` | Pinned notices (priority, expiry). |
| `snooze_requests` / `swap_requests` | Postpone + trade requests. |
| `ai_verifications` | AI photo-analysis results (confidence, decision, cost_cents). Linked to a completion. |
| `weekly_reports` | Per-week household report (report_data JSON, ai_suggestions, mvp). Unique per household+week_start. |
| `subscriptions` | Billing/entitlement per user+household (14-day default trial). Gates writes via RLS. |
| `push_subscriptions` | Web-push endpoints per user (unique endpoint). |
| `notification_preferences` | ~18 per-member category toggles + push/email channel + reminder_time. |
| `referral_codes` / `referral_redemptions` | Referral program (system-managed). |
| `activity_feed` | Append-only event stream (35 action types, reactions JSON). |

### Key enums / status sets (CHECK-enforced)
- `households.mode`: family | roommate | office
- `members.role`: parent | kid | roommate | manager | colleague
- `assignments.status`: pending | in_progress | completed | overdue | skipped | pending_review | snoozed_pending_approval
- `completions.status`: pending_approval | approved | rejected | ai_approved
- `reward_redemptions.status`: pending | approved | rejected
- `goals.status`: active | completed | canceled | pending_approval
- `subscriptions.status`: trialing | active | past_due | canceled | unpaid | incomplete
- `bonus_challenges.challenge_type`: double_points | complete_count | no_overdue | custom; `status`: active | completed | failed | expired
- `competitions.competition_type`: most_points | most_completions | first_to_target | specific_chore_race; `status`: pending | active | completed | declined | expired
- `settlements.payout_type`: money | treat | gift | privilege | experience | custom; `source_type`: goal_payout | competition | reward_redemption | allowance | manual; `status`: pending | settled | forgiven | declined; `settled_via`: venmo | paypal | cashapp | apple_cash | cash | in_person | other
- `shopping_items.category`: produce | dairy | meat | bakery | frozen | pantry | beverages | snacks | cleaning | household | personal | pets | other
- `goal_contributions.source`: chore_completion | bonus | manual | transfer
- `point_gifts.gift_type`: general | birthday | thank_you | bonus
- `custom_badges.criteria_type`: manual | chore_count | category_count | streak | speed_bonus_count | points_total
- `ai_verifications.provider`: openai | anthropic; `decision`: auto_approved | flagged_for_review | auto_rejected
- `announcements.priority`: normal | important | urgent
- `activity_feed.action_type`: 35 values (chore_completed, level_up, achievement_earned, streak_milestone, points_gifted, goal_progress/completed, challenge_/competition_completed, settlement_created/settled/forgiven, birthday, household_milestone, poll_created/closed, snooze_/swap events, etc.)

### Security model (RLS) — reproduce conceptually on the new stack
- **`user_household_ids()`** (security-definer): the array of household_ids where the caller is an *active* member. Nearly every policy is `household_id = ANY(user_household_ids())`.
- **`household_has_active_subscription(hid)`**: true if the household has an `active`/`trialing` subscription. Added as an extra INSERT check on ~17 billable content tables → this is the **read-only-after-trial** enforcement.
- **`get_member_permissions(uid, hid)`**: returns `{role, mode, is_admin, can_create_chores, can_approve, needs_approval}` for role/mode policy branching.
- Family vs roommate/office branching: admin-only actions require `parent` in family mode but are open to any member in roommate/office mode (pattern `is_admin OR role='roommate'`).
- Owner-scoped tables (no household join): `webauthn_*`, `push_subscriptions`, `notification_preferences`, `subscriptions`.
- System/trigger-written tables (achievements, milestones, activity_feed, ai_verifications, weekly_reports, referral_*) are written by security-definer triggers/RPCs that bypass RLS.

### Triggers & atomic RPCs (the business logic lives here)
**Economy trigger** `handle_completion_insert` (BEFORE INSERT completions): computes points, marks the assignment completed, updates member points/XP/level/streak, writes activity, unlocks achievements (`first_chore`/`streak_7`/`streak_30`), auto-contributes to goals, checks household milestones, advances competitions, evaluates custom badges. **Only `approved`/`ai_approved` completions count toward fairness, milestones, streaks, and badge criteria.**

Other triggers: `handle_new_user` (profile), `handle_new_member` (notification prefs), `handle_new_member_shopping_list` (default Groceries list), `handle_new_household` (referral code), `handle_assignment_overdue` (streak reset), `handle_ai_verification` (sets completion status from decision), `handle_reward_redemption` / `handle_goal_contribution` / `handle_point_gift` (activity + side effects), settlement created/settled/forgiven, snooze created/approved/denied, poll created/closed, quick_task completed, custom_badge award.

**Atomic, row-locking RPCs (`SECURITY DEFINER`) — keep point mutations server-side and race-safe:**
- `redeem_reward` — lock member, check balance, deduct, insert redemption (pending).
- `refund_redemption` — refund points, mark rejected.
- `contribute_to_goal` — deduct, add to goal, auto-complete at target.
- `transfer_points` — atomic gift (deduct sender, credit receiver).
- `award_bonus_points` — increment balance (floored at 0) + XP (positive only); used by cron for challenge/competition payouts.

### Storage buckets
| Bucket | Visibility | Purpose | Path |
|---|---|---|---|
| `avatars` | Public | Profile photos | `{household_id}/{user}.{ext}` |
| `proof-photos` | Private (60s signed URLs) | Before/after completion photos (~1 MB compressed) | `{household_id}/{assignment_id}/{before\|after}.jpg` |
| `chore-references` | Private | Per-chore "gold standard" photos (~500 KB) | `{household_id}/{chore_id}.jpg` |
| `feedback` | Public (undocumented) | In-app feedback screenshots | `feedback/{user_id}/{ts}.{ext}` |

### Integrity rules to preserve
- Positive-value CHECKs (points_cost, target_points, gift points, settlement amount_cents).
- Range CHECKs (difficulty 1–5, health_score 0–100, allowance_threshold 0–100, AI scores 0–100).
- Length CHECKs (snooze reason ≤300, comment body ≤500, poll question ≤200).
- Uniqueness (invite_code, stripe ids, members(household,user), achievements(member,badge_key), milestones, custom_badge_awards, weekly_reports(household,week_start), push endpoint, etc.).
- **Atomicity:** all race-sensitive point mutations are RPCs; migration 007 removed duplicated point math from triggers so the RPC is the single source of truth.

---

## 8. Key End-to-End Flows

**A. First-run / onboarding.** Sign up (email/Google/passkey) → profile created → onboarding: create household (name + mode) *or* join (invite code) → (admins) pick preset chores → profile (name, birthday, color, payment handles) → trial activation (14-day trial subscription created) → dashboard. Joiners skip preset chores; family joiners default to `kid`.

**B. Daily chore loop.** Member opens dashboard → sees today's + overdue assignments → opens an assignment → Start (timer, status `in_progress`) → checks off checklist → Mark Done → completion modal (optional before/after photos + notes, live points preview) → submit.

**C. Complete → approve → points.** On submit: roommate/adult → auto-approve, points awarded instantly, fairness updates. Family kid (approval-required chore) → completion `pending_approval`, assignment `pending_review` → parent reviews in approval queue (sees photos/notes, optional AI badge) → approve (points finalized, celebration) or reject (reason → redo). *(Decide: hold points until approval — see §6/§11.)*

**D. AI verification path.** If both photos present + AI enabled (chore & household): photos → vision model → confidence/decision → auto-approve (`ai_approved`) / flag (`pending_approval`) / auto-reject (`rejected`), within the monthly cost cap.

**E. Rotation.** Admin creates a recurring schedule → rotation group + pre-generated assignments → daily cron advances the group on interval boundaries, skipping away members, minting the next assignment.

**F. Settle-up.** A goal payout / reward redemption / competition / weekly allowance (or a manual IOU) creates a settlement → appears on the Settle-Up page and member profiles → debtor pays (deep-link for money) and marks settled, or creditor forgives.

**G. Gamification loop (family).** Earn points/XP → level up (celebration) → unlock badges → redeem rewards (parent approves) → save toward goals (auto-contribute) → compete in challenges/competitions → weekly report card + MVP.

---

## 9. Platform, Navigation & Non-Functional

### Navigation (mode + role aware, single config source)
Desktop: collapsible left sidebar (64px icons ↔ 256px labels) with admin Settings/Billing footer links. Mobile: fixed bottom tab bar. Both use the **same** per-role tab list. Header: household switcher (only if >1 household), mode badge, date, member avatars, user menu, notification bell.

Tab sets: **Family/parent** Home · Schedule · Fairness · Rewards · Settings; **Family/kid** Home · Goals · Rewards · My Stats (→fairness); **Roommate** Home · Schedule · Fairness · Settings. *(Many routes — challenges, competitions, members, tasks, shopping, reports, year-in-review, settle-up, bundles, approvals — are reachable only via deep links, not the tab bars.)*

### Screen inventory
**Authenticated (`/app`):** dashboard, schedule, fairness, chores (+ new, [id]), assignments/[id], approvals, rewards, goals (+ new), challenges (+ new), competitions (+ new), members (+ [id]), profile, settings, reports, year-in-review, settle-up, shopping, tasks, bundles (+ new), billing, share-intake.
**Auth:** login, signup, forgot-password, reset-password, callback.
**Public/other:** `/` (landing), onboarding, join/[code], privacy, terms; plus error/not-found/loading.

### Design system & theming
shadcn/ui (new-york style) on Radix + Tailwind, Lucide icons, Framer Motion animations, Sonner toasts, Recharts. **Dark theme by default** (system-enabled). Brand: indigo `#6366f1` primary, near-black `#0a0e1a` background, Inter font. 12-color accent palette for member avatars. ⚠️ The per-member "accent picker" only colors avatars; it does **not** re-theme the app (the global accent is fixed indigo).

### PWA & offline
Installable (manifest with icons/screenshots/shortcuts/share-target); start URL `/dashboard`; app shortcuts to Today/Fairness/Shopping; Serwist service worker for offline caching (disabled in dev). Theme color `#6366f1`, background `#0a0e1a`.

### Mobile (Capacitor)
Native iOS/Android shell using a **remote-URL wrap** (`server.url` points at the hosted web app), `appId com.manyhandz.app`. Splash 2s on `#0a0e1a`. ⚠️ Native push registration is **not** wired (web-push/VAPID is the only implemented push path). The Capacitor architecture decision is a launch blocker (see §11).

### Cron jobs (CRON_SECRET bearer-protected POST endpoints)
| Endpoint | Cadence (doc-only) | Purpose |
|---|---|---|
| `/api/cron/rotate-assignments` | Daily | Advance rotation groups on interval boundaries; mint next assignments. |
| `/api/cron/check-overdue` | Hourly | Flip past-due assignments to overdue; push alerts (streak reset via trigger). |
| `/api/cron/check-birthdays` | Daily | Per-timezone birthday detection; activity entry + household push. |
| `/api/cron/check-challenges` | Hourly | Resolve expired challenges; award bonus to all members. |
| `/api/cron/check-competitions` | Hourly | Resolve competitions; transfer stakes. |
| `/api/cron/generate-reports` | Weekly (Sun) | Weekly reports, MVP, health score, allowance settlements, recurring shopping items, auto-close polls. Only for active/trialing households. |

⚠️ **Cadence is documentation-only** — there is no scheduler config in the repo. The new stack must explicitly configure these schedules.

### Security headers & hardening (preserve)
CSP, HSTS, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy. Zod validation on API inputs; in-memory token-bucket rate limiting (notably applied to AI + export + auth). ⚠️ A CSRF helper module exists but appears largely unused — decide whether to implement CSRF properly.

---

## 10. Integrations

| Integration | Role | Notes for rebuild |
|---|---|---|
| **Supabase** | Postgres DB, Auth, Storage, Realtime, RLS | The product is deeply coupled to RLS-as-authorization and DB triggers/RPCs-as-business-logic. If you move off Supabase, you must re-home this logic into your app/service layer and keep it **atomic** and **server-authoritative**. Three client types (browser/server/service-role) — the service-role client must never reach the client. |
| **Stripe** | Subscriptions (Checkout + Customer Portal + webhook) | Webhook signature verification + service-role DB writes. iOS **cannot** use Stripe for in-app subscriptions (see §11 payments blocker). |
| **Resend** | Transactional email | 8 templates exist but **sends are not wired** — implement them. |
| **OpenAI** (`gpt-4o`) | Default AI provider (verification, suggestions, photo-to-task, parse-text) | |
| **Anthropic** (`claude-sonnet-4-20250514`) | Alternate AI verification provider | When building anew, consider the latest Claude models; pin the exact model id. |
| **web-push (VAPID)** | Browser push | Only overdue + birthday currently send. |
| **WebAuthn (`@simplewebauthn`)** | Passkeys | Native mobile needs a Capacitor plugin or fallback. |

---

## 11. ⚠️ Known Discrepancies, Dead Code & Decisions to Make

This is the highest-value section for a rebuild: the previous code disagrees with its own spec and, in places, with itself. **Decide each of these deliberately rather than inheriting the ambiguity.**

### A. Economy & rules (decide the canonical values)
1. **Points formula — three conflicting implementations.** DB trigger uses `difficulty × 10` (+ double-points multiplier + speed only); `points.ts` uses `ceil(difficulty × min/15)` + streak/photo/early; the completion preview is a third variant. Streak/photo/early bonuses are **never actually awarded** today. **Recommend:** adopt the `points.ts` formula, implement once, server-side. (Affects fairness and leveling.)
2. **Photo bonus:** code = **+1 each / +3 both** (spec said +2/+4).
3. **Early-completion bonus:** code = **+2** (spec said +5).
4. **AI thresholds:** DB defaults **85/40** vs route fallbacks **80/30**. Pick one (recommend 85/40).
5. **Does approval gate points?** Today points are awarded on completion insert regardless of approval; rejection doesn't claw back. **Recommend:** hold points until approved.
6. **Approver identity is defined 3 ways** (parent+manager / parent+manager+roommate / isAdmin). Unify.
7. **Snooze guardrails** ("max 3 snoozes / max 7 days") are **not implemented**; there's also a **snooze_count double-increment** bug.
8. **Two point pools** (`points_balance` spendable vs `total_xp` lifetime) — keep them distinct; old docs conflate "points."
9. **Status vocabulary drift:** assignments use `pending_review`/`snoozed_pending_approval`; completions use `pending_approval`. Unify/clearly document.
10. **Monthly rotation** is a 30-day approximation, not calendar months (drifts over a year).

### B. Features that are backend-only / unwired (build the UI or drop)
- **Polls** — complete data layer + components, **zero screens**.
- **Announcements** — full CRUD hook, **no UI**.
- **Chore swaps** & **snooze request creation** — data layer only, **no creation UI**.
- **AI photo-to-task** & **AI parse-shared-text** — backend routes with **no caller**.
- **Recurring shopping items** — cron + data model, **no rule-creation UI**.
- **In-app notification bell** — permanent empty placeholder.
- **Supabase DB webhook** — verified **no-op**.

### C. Dead code / never-fired
- **All 8 Resend email templates** — `send()` is never called.
- **System badge catalog (45–47 badges)** — unearnable; only 3 mismatched trigger keys exist.
- **5-component health-score gauge UI** — orphaned; real score uses 3 components.
- **Reusable comments component/hook** — never imported (an inline duplicate ships instead).
- **Leaderboard period filter** — cosmetic (always lifetime XP).
- **Challenge complete-count progress bar** — hardcoded to 0.
- **5 "special" household milestones** — no detection logic.
- **Referral free-month credit** — codes generated but credit never applied.
- **Bundle +10% completion bonus** — never implemented.
- **Goal → settlement ("Fulfill Goal")** — not implemented.

### D. Concrete bugs to not reproduce
- Chore form writes category **name** into a UUID FK (`category_id`) — category assignment broken.
- Reference-photo upload in chore form is a non-functional stub.
- Migration 008 indexes `ai_verifications(assignment_id)` — **that column doesn't exist** (link is `completion_id`).
- `assignment_comments.member_id` and `announcements.author_id` are `NOT NULL` **and** `ON DELETE SET NULL` — contradictory.
- `point_gifts`: both a trigger **and** the `transfer_points` RPC move points — **double-move risk** if both fire (migration 007 fixed this for rewards/goals but **not** gifts). Route gifts through the RPC only.
- Two photo pipelines (inline base64 vs `proof-photos` bucket) — the shipping path stores large base64 inline.
- Completion preview total ≠ awarded total.

### E. Stale docs (code is ground truth)
- Template counts: code = Pets 4 / General 3 (spec said 5/4).
- Referral code format: code = `MH-XXXXXXXX` (spec said `MANYHANDZ-XXXX`).
- Webhook events: code omits `invoice.payment_succeeded` (spec listed it).
- Middleware does **not** set an `x-subscription-status` header (defers to DB RLS).
- `MANYHANDZ_SCHEMA.sql` (standalone) is **pre-migrations**; the migration chain `001→008` is authoritative.

### F. App Store / platform launch blockers (decide before any build)
1. **Capacitor architecture:** remote-URL WebView wrap (fast; "just a website" rejection risk; offline-limited) vs static SPA + hosted API (offline-first; large refactor). **Blocks all other store work.**
2. **iOS payments:** Apple requires IAP for in-app digital subscriptions — **Stripe-only will be rejected**. Options: RevenueCat/StoreKit IAP + Stripe for web/Android (price parity ±15%); External Purchase Link entitlement (27% + scare screen); or iOS-free / force-web-subscribe.
3. **Sign in with Apple** required if Google OAuth is offered — not built.
4. **Account deletion** must truly cascade-delete (Apple requirement) — verify.
5. Native permission strings (camera, photo library, Face ID, notifications), real app icons/splash/screenshots, version bump to 1.0+.
6. **Light mode** (spec'd, never verified) and **i18n** (English-only) — decide if in scope.

---

## 12. Rebuild Recommendations

### Must-preserve (the product's identity)
- **Config-driven dual-mode engine** — derive *all* permissions/nav/features/UI tone from a per-mode config object; never branch on raw role/mode strings. This is the central architectural bet.
- **Effort-weighted fairness** — weight by difficulty × time so a hard 40-min chore outweighs an easy 5-min one. This is the differentiator.
- **Read-only-after-trial enforced server-side** (DB/authorization layer), not just in the UI; trial "active" derived from **both** status and `trial_end > now` (resilient to webhook lag).
- **Approval asymmetry** — family kids' completions need approval before points; roommate mode is honor-system instant approval.
- **Settle-Up treats non-monetary obligations** (treat/gift/privilege/experience/custom) as first-class, with forgive.
- **AI verification is opt-in per household AND per chore**, SSRF-restricted to your storage hosts, size-capped, with a monthly cost cap and graceful fallback to manual.
- **Atomic, server-authoritative point mutations** (redeem/refund/contribute/gift/bonus) — never read-then-write on the client.
- **Penalty-free skips** (Birthday Pass, Away/Vacation) excluded from fairness.
- **Three-tier data access** (browser/server/privileged) — the privileged/service client never reaches the client.
- Brand identity: dark-first, indigo `#6366f1`, Inter, "Many hands make light work."

### Do differently (fix the inherited problems)
- **One canonical points engine**, implemented once, server-side; make preview == award.
- **Normalize reactions** (and votes) into tables instead of last-write-wins JSON blobs.
- **Consolidate comments** to a single realtime implementation.
- **Wire the notification system end-to-end** — actually send the emails and event pushes; back the in-app bell with a real source.
- **Decide the fate of unwired features** (polls, announcements, swaps, AI photo-to-task/parse-text, recurring shopping) — build or cut, don't ship half.
- **Implement (or remove) the referral credit, bundle bonus, goal→settlement, and special milestones** rather than leaving them as inert hooks.
- **Resolve the platform/payments decisions** (Capacitor wrap, IAP) before building store features.
- Reconcile the **status vocabularies** and the **approver rule** into one model.

### Scope guidance
The previous build is **feature-complete against its spec with no missing pages** — its real debt was *behavioral* (≈half of flows never E2E-verified) and *consistency* (the discrepancies above). For the rebuild, treat this brief's **§6 economy**, **§7 data model**, and **§11 decisions** as the contract; the feature catalog (§5) as the scope; and the dual-mode engine (§2) as the architecture to protect.

---

*End of brief. Companion source documents in this repo for deeper reference: `MANYHANDZ_SPEC.md` (original detailed spec, including UI/animation detail — note stale values per §11), `MANYHANDZ_SCHEMA.sql` + `supabase/migrations/001–008` (data model; migrations are authoritative), `FUNCTIONALITY_INVENTORY.md` (build-status matrix), `REVIEW_FINDINGS.md` (21 resolved defects), `APP_STORE_READINESS.md` (submission checklist).*
