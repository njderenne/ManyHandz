# ManyHandz — Detailed Feature Specification

> This file is the full reference spec for the ManyHandz application.
> It is read by Claude Code from disk during the build — NOT pasted into chat.
> Sections are organized so specific features can be located quickly.

---

## DESIGN SYSTEM — DARK THEME, MOBILE-FIRST

Premium dark UI as default. Use `next-themes` with `defaultTheme="dark"` and `ThemeProvider` wrapping the app in the root layout. Light mode available via toggle in Settings. Use shadcn/ui components with **zinc** base color. Use `cn()` utility (`clsx` + `tailwind-merge`) for all conditional class merging.

Mobile-first responsive design — should look and feel like a native mobile app on phones, expanding gracefully to tablet/desktop. Must work well in Capacitor WebView.

### Color Palette

```
Background:
  --bg-primary: #0a0e1a        (deepest background)
  --bg-secondary: #111827       (card backgrounds)
  --bg-tertiary: #1f2937        (elevated surfaces, inputs)
  --bg-hover: #374151           (hover states)

Text:
  --text-primary: #f1f5f9       (primary text, headings)
  --text-secondary: #94a3b8     (secondary text, labels)
  --text-muted: #64748b         (muted text, timestamps)

Brand / Accent:
  --accent-primary: #6366f1     (indigo — primary actions, active nav)
  --accent-primary-hover: #818cf8
  --accent-secondary: #22d3ee   (cyan — secondary highlights, points)
  --accent-success: #34d399     (green — completed, approved)
  --accent-warning: #fbbf24     (amber — pending, medium fairness)
  --accent-danger: #f87171      (red — overdue, rejected)

Borders:
  --border-default: rgba(148, 163, 184, 0.12)
  --border-focus: rgba(99, 102, 241, 0.5)

Fairness Score Colors (gradient):
  0-30%: #f87171 (danger)   30-45%: #fbbf24 (warning)
  45-55%: #34d399 (success)  55-70%: #fbbf24 (warning)
  70-100%: #6366f1 (accent)
```

### Typography
- Font: Inter (Google Fonts)
- Headings: font-semibold or font-bold
- Body: text-sm (14px) base on mobile, text-base (16px) on desktop
- Monospace numbers: tabular-nums for scores, points, stats

### Component Design Patterns
- Cards: rounded-2xl, bg-secondary, border border-default, subtle shadow
- Buttons: rounded-xl, font-medium, with hover/active transitions
- Inputs: rounded-xl, bg-tertiary, border-default, focus:border-focus with ring
- Modals: centered overlay with backdrop blur, slide-up on mobile
- Bottom nav: fixed bottom on mobile, left sidebar on desktop (≥1024px). Tabs vary by mode:
  - Family parent: Home, Schedule, Fairness, Rewards, Settings (5)
  - Family kid: Home, Goals, Rewards, My Stats (4)
  - Roommate: Home, Schedule, Fairness, Settings (4)
- Transitions: Framer Motion for page transitions, card interactions, celebrations
- Toast notifications: top-right desktop, top-center mobile (Sonner)

### Mobile-First Layout Rules
- Default: single column, full-width cards, 16px padding
- md (768px): 2-column grid where appropriate
- lg (1024px): sidebar nav, main content max-width constraint
- xl (1280px): wider sidebar, more spacious layouts
- Touch targets minimum 44x44px on mobile
- Swipe gestures: right on assignment = complete, left = skip

---

## HOUSEHOLD MODES — FAMILY vs. ROOMMATE

The household `mode` column drives the entire UX. Every component must be mode-aware via `useHouseholdMode()`.

### Mode Selection During Onboarding
- **"Family"** — family icon, "Parents manage chores, kids earn rewards and work toward goals."
- **"Roommates"** — group icon, "Equal housemates sharing responsibilities fairly."
- Sets `households.mode` and creator's role (`parent` for family, `roommate` for roommate).

### FAMILY MODE

**Roles:** `parent` (full admin) and `kid` (restricted)

**Permissions (Family):**

| Action | Parent | Kid |
|--------|--------|-----|
| Create/edit/delete chores | Yes | No |
| Create/edit rotation rules | Yes | No |
| Assign chores | Yes | No |
| View all assignments | Yes | Yes (view only) |
| Mark own chore complete | Yes | Yes (triggers approval) |
| Submit photo proof | Yes | Yes |
| Approve/reject completions | Yes | No |
| Create/edit rewards | Yes | No |
| Redeem rewards | Yes | Yes (triggers approval) |
| Create goals for anyone | Yes | No (self only) |
| Contribute points to own goals | Yes | Yes |
| Invite members | Yes | No |
| Change member roles | Yes | No |
| Edit household settings | Yes | No |
| Access billing | Yes | No |
| Create bonus challenges | Yes | No |
| Gift points | Yes | Yes (toggle-able) |
| Create competitions | Yes | Yes (kid-to-kid, toggle-able) |
| Configure AI verification | Yes | No |

**Approval Workflow (Family):**
1. Kid taps "Mark Done" → optionally uploads photo + note
2. Completion created with `status = 'pending_approval'`, `needs_approval = true`
3. **No points awarded yet**
4. Parents receive push: "Jake says he finished Clean Bathroom. Verify?"
5. Parent opens approval queue → sees photos, note, timestamp
6. Approve → points awarded, celebration notification to kid
7. Reject with feedback → push to kid with reason, assignment returns to `in_progress`
8. Approval queue shows badge count on dashboard and nav

**UI Tone (Family):** Colorful, playful for kids. Gamification front-and-center: levels, XP bars, badges, streaks, goal progress. Big celebration animations. Parents see utilitarian admin view. Kid greeting: "Hey Jake! You have 3 chores today. Let's go!"

### ROOMMATE MODE

**Roles:** `roommate` (everyone equal). Creator is also `roommate` — only special privilege is being Stripe billing owner.

**No Approval Workflow:** Complete → instant approval → points awarded → fairness updates. Honor system.

**Hidden in Roommate:** Rewards store, big-ticket goals, XP levels/celebrations, badges (optional toggle), leaderboard (optional toggle), approval queue, goal suggestions.

**Prominent in Roommate:** Fairness scoring (THE killer feature), auto-rotation, chore board/calendar, photo proof (optional), push notifications, bonus challenges, point gifting, weekly report (stats only, no grades), birthday system, milestones, activity feed, points/streaks (lightweight text display, no gamification).

**UI Tone (Roommate):** Clean, minimal, adult-oriented. Simple check animation (no confetti). Difficulty as "Easy/Medium/Hard" text. Fairness page is the hero feature.

### MODE-AWARE COMPONENT ARCHITECTURE

Config-driven via `lib/constants/modes.ts` with `ModeConfig` interface containing: `enabled`, `label`, `description`, `icon`, `roles`, `creatorRole`, `defaultJoinerRole`, `features` (gamification, rewards, goals, approvalWorkflow, fairnessScoring, leaderboard, photoProofDefault, paymentHandles, bonusChallenges, pointGifting, weeklyReportCard, birthdaySystem, accentColors, headToHead, aiVerification, speedBonus), `ui` (difficultyDisplay, completionAnimation, tonePlayful, showPointsProminent), `navTabs` (per role), `permissions` (per role, all boolean flags).

`useHouseholdMode()` hook returns: `mode`, `role`, `config`, `permissions`, `features`, `ui`, `navTabs`.

Components read from config — never check mode/role strings directly. New modes (office) addable by defining a new config entry only.

### OFFICE MODE (Future — enabled: false)

Defined in schema/config but NOT exposed in UI. Professional tone, no gamification/rewards/goals. Auto-rotation, fairness, calendar, optional photo proof. Roles: `manager` and `colleague`.

### JOINING A HOUSEHOLD

- Family mode: parent selects role for new member (default `kid`, can promote)
- Roommate mode: auto-assigned `roommate`

---

## PAGE SPECIFICATIONS

### 1. Landing Page (`/`)
- Hero: "ManyHandz — Many hands make light work." CTA: "Start Free Trial" + Login
- "Built for every household" — side-by-side Family vs Roommate comparison
- Feature showcase sections (fairness, rotation, photo proof, gamification, payments)
- Pricing: single plan, monthly/annual toggle: $9.99/month or $99.99/year (save ~17%), 14-day trial, feature checklist, CTA
- FAQ, testimonials (placeholder), footer (Terms, Privacy, Support)

### 2. Sign Up (`/signup`)
- "Sign up with Google" (prominent, top) → Supabase OAuth
- Divider → email/password form below
- Full name, password strength indicator
- After signup → redirect to `/onboarding`

### 3. Login (`/login`)
- "Sign in with Google" (prominent)
- "Sign in with Passkey" (WebAuthn, conditional on browser support)
- Divider → email/password form
- "Forgot password?" link
- After login → `/dashboard` (or `/onboarding` if no household)

### 4-5. Forgot/Reset Password
- Standard Supabase auth flows

### 6. Onboarding (`/onboarding`)
- **Step 1 — Create or Join:** Create household (name + mode selection with visual cards), or join via invite code
- **Step 2 — Your Profile:** Display name, avatar (camera/file + crop-to-square), birthday, bio, favorite color, payment handles
- **Step 3 — Trial Activation:** "14-day free trial, no credit card." Mode-appropriate feature highlights. Referral code input (pre-filled if arrived via `/join?ref=XXXX`). Both households get 1 free month.
- Create `subscriptions` row: status='trialing', trial_end = now + 14 days
- Role assignment: family creator→parent, family joiner→kid, roommate creator/joiner→roommate

### 7. Dashboard (`/dashboard`)
**The main screen — mode-aware, renders differently per mode+role.**

**Common elements:**
- Trial Banner (dismissible, gets prominent last 3 days)
- Birthday Banner (confetti, "Send Birthday Gift" button, respects mute_celebrations)
- Active Challenge Card (countdown, progress, multiplier badge)
- Active Competition "VS" Card (avatars, scores, countdown)
- Milestone celebration banner (one-time, auto-dismiss)
- Announcement Banner (priority-colored border)
- Quick-Add Chore (inline input, admin/roommate only)
- Header: household name, switcher dropdown, member avatars, date
- Quick Stats Bar: due today, completed today, household streak
- Settle Up Widget: pending items (money and non-money)
- Today's Assignments (sorted by priority)
- Activity Feed (real-time, reactions: 👍 ❤️ 🔥 ⭐ 👏)
- Weekly Report Card Link (Sundays/Mondays)
- Overdue Section (red-highlighted)
- Quick Tasks Widget (compact checkable items)
- Shopping Widget ("8 items needed")
- Bundle Progress Widget
- AI Suggestions Widget (top 2-3 suggestions, dismiss buttons, "Powered by AI")
- Household Health Score gauge (0-100, colored ring, trend sparkline, 5-component breakdown on tap)
- Active Polls (voteable cards, live bar charts)

**Family — Parent view:** Approval Queue Badge ("3 need verification" + "2 postpone requests"), points, level/XP bar, goal previews, FAB for new chore, all members' overdue

**Family — Kid view:** Fun gamified header, Level & Streak Bar (HERO), points with coin icon, goals as horizontal scrollable progress rings, simplified assignment cards (reference photo thumbnail, checklist progress, Start/Mark Done/Postpone buttons, status indicators), no FAB, own overdue only

**Roommate view:** Clean header, no XP/level/goals, Fairness Mini-Widget, simple streak text, clean assignment cards (difficulty as text, simple "Done" button), FAB for new chore, all overdue, clean activity log

### 8. Schedule (`/schedule`)
- Week View (default, 7-day columns, color-coded by member)
- Month View (calendar grid with dot indicators)
- Filter by member, category, status
- Admin drag-and-drop reassign (desktop) or tap reassign (mobile)

### 9. Fairness (`/fairness`)
- Large circular gauge per member, color-coded
- Period selector (this/last week/month, custom)
- Contribution pie chart (weighted by difficulty+time)
- Trend line chart (weekly fairness over time)
- Detailed stats table
- "Most Avoided" section
- Household streak (zero overdue days)

### 10. Rewards (`/rewards`) — FAMILY MODE ONLY
- Tabs: Rewards | Achievements | Leaderboard
- Your Stats Header (points counter, level/XP bar, streak)
- Available Rewards Grid (name, icon, cost, "Redeem" button, grayed if insufficient)
- Pending Redemptions (admin approve/reject)
- Achievement Badges Grid (trophy-case, earned glow / unearned gray+lock):
  - Beginner: First Step, Getting Started, Snap Happy
  - Consistency: On a Roll (3d), Week Warrior (7d), Streak Master (30d), Iron Will (60d), Legendary (100d)
  - Points: Century Club (100), Household Hero (500), Point Machine (1000), The 1% (5000)
  - Skill: Early Bird, Night Owl, Speed Demon, Efficiency Expert, Lightning Round, Photographer, Before & After Pro, All-Rounder, Team Player
  - Competition: Challenger, Victorious, Undefeated, Rival, High Roller
  - AI: AI Approved (10), Perfectionist (95%+ x5), Machine Verified (50)
  - Fairness: Fairness Champion (4 weeks), Balance Keeper (8 weeks)
  - Level: Level 5/10/25/50
  - Goal: Dream Setter, Goal Getter, Ambitious
  - Social: Birthday Star, Generous, Philanthropist, Most Loved, Challenge Champion
- Leaderboard (toggle by admin, rank by points this week/month/all-time, crown/#1, medals)

### 10b. Goals (`/goals`) — FAMILY MODE ONLY
- Active Goals Grid (progress ring, %, points remaining, monetary value, "Contribute Points" button, estimated completion date)
- Completed Goals gallery
- Create Goal: title, description, icon, target points, monetary value, assigned to, auto-contribute toggle + percentage
- Goal Detail: full progress, contribution history, projected date, "Fulfill Goal" button (admin) → creates settlement (money: payment flow; non-money: parent selects payout_type)
- Goal suggestions: "New Video Game" (500/$60), "Pizza Night" (300), "Extra Screen Time" (100), "$25 Cash" (400/$25), etc.

### 11. Chores Management (`/chores`)
- Chore Library (grid/list, filter, search)
- Create Chore: name, description, category, difficulty (1-5 stars), estimated minutes, icon picker, reference photo upload (compressed, `chore-references/{household_id}/{chore_id}.jpg`, signed URLs), checklist steps (inline add/reorder/delete, stored as jsonb), rotation settings, AI verification toggle
- Chore Detail: edit, reference photo display, completion history, rotation info, stats (times completed, avg time, who does most, avg AI confidence)
- Chore Templates: Kitchen (6), Bathroom (5), Living Areas (5), Bedroom (4), Outdoor (5), Laundry (4), Pets (5), General (4) — each with pre-built checklists

### 12. Assignment Detail (`/assignments/[id]`)
- Full info: chore, member, due date, status
- Reference Photo ("The Goal" card, tappable full-screen, "Make it look like this!" for kids)
- Checklist Steps (checkboxes, progress bar, real-time sync, optional gating)
- Postpone Button → Snooze Modal
- Comments Thread (chronological, 500 char max, 50 max, real-time)
- **Completion Flow:**
  - Family Kid: Start → before photo → timer → Done → after photo → notes → submit (pending_approval or AI decision)
  - Family Parent: same flow but auto-approved
  - Roommate: Start (optional) → Done → instant approval
- Photo Proof Display: side-by-side comparison slider, AI Verification Badge + expandable panel
- Rejection & Redo callout with "Try Again" button
- Swap, Timer/Speed display, Competition indicator, Reassign, Skip buttons

### 13. Members (`/members`)
- Member Grid (avatar, name, role badge, level, points, streak, status)
- Invite: code + copy button, share link, QR code
- Member Profile: avatar (colored ring), name, role, level/XP, bio, age, joined date, birthday display, "Gift Points" button, payment handles with deep-link buttons, Settle Up balance, stats, goals, contribution chart, recent activity, admin actions

### 14. Settings (`/settings`)
- Profile (name, photo upload+crop, email, birthday, bio, favorite color picker, timezone)
- Away Mode toggle + date + reason
- Celebration Preferences (mute toggle)
- Passkeys/WebAuthn (list, add, rename, delete)
- Payment Handles (Venmo, PayPal, Cash App, Apple Cash)
- Household (name, mode badge, regenerate invite, photo proof toggle)
  - Family-only: approval toggle, checklist gating, snooze approval, leaderboard, auto-contribute %, kid gifting, kid challenges, kid competitions + max stakes
  - AI Verification: master toggle, provider, thresholds, cost cap, usage display
  - Roommate-only: achievements toggle, leaderboard toggle
  - Custom categories, custom badges links
  - AI Suggestions toggle
  - Referral Program (code, share, stats, history)
  - Data Export (CSV/PDF/JSON)
  - Timezone, delete household
- Notification Preferences (all toggles per type, email section)
- Billing (status, trial countdown, subscribe/manage, payment history)
- Account (change password, connected accounts, sign out, delete account)
- Support (send feedback form, contact support, replay tutorial)

### 15. Billing (`/billing`)
- Trial Banner, Subscription Card, Subscribe/Manage button
- Monthly ($9.99) / Annual ($99.99) toggle
- Stripe Checkout redirect, Customer Portal
- Trial expired → persistent paywall modal, read-only mode

### 16. Challenges (`/challenges`)
- Active challenges (countdown, progress, multiplier badges)
- Create Challenge: type (Double Points, Completion Count, No Overdue, Custom), title, description, duration, targets, multiplier
- Challenge Card: countdown (per-second < 1hr), progress bar, participants
- Past challenges with results
- One double-points active at a time

### 17. Weekly Report Card (`/reports`)
- Current week (generated Sundays)
- Per-Member: completions ratio, letter grade (A+ through F), points, streak, goal progress, fairness delta, star chore, labels (Most Consistent/Improved/MVP/Needs Attention)
- Household Summary: total completed, streak, MVP (crown), milestones, challenges
- Previous weeks (scrollable, expandable)
- Share as image, included in email digest
- Family mode: playful with grades. Roommate mode: clean stats, no grades.

---

## FEATURE SPECIFICATIONS

### Chore Swap / Trade System
- "Swap" button on pending assignments → modal showing other members' pending assignments
- Select exchange assignment (or free swap)
- Push notification to target → Accept/Decline → assigned_to fields swap
- Auto-expire at due date. Parents can reassign directly.

### Multi-Household Switching
- Dropdown in header showing all households
- Switching reloads all data for new household context
- All hooks filter by active household_id from Zustand store (persisted)
- Hidden if only one household

### Vacation / Away Mode
- Set away_until + reason. While away: rotation skips, no new assignments, future assignments unassigned, no streak penalty, "Away" badge, excluded from fairness. Auto-clears when date passes.

### Email Notifications (Resend)
- Branded dark HTML templates in `lib/resend/templates.ts`
- Types: Weekly Digest, Approval Request, Overdue Alert, Trial Expiring (3d + 1d), Payment Failed, Goal Completed, Welcome Email
- Independent toggle from push (email_enabled column)

### Join Route (`/join/[code]`)
- Not authenticated → show household name/mode, signup/login buttons, auto-join after auth
- Authenticated, not member → confirm join
- Already member → redirect with toast
- Invalid code → error
- Persist invite code through auth flow

### Custom Chore Categories
- Category Manager (settings/chores page)
- Create: name, Lucide icon, color picker
- Household-specific. Can't delete defaults.

### Chore Timer & Speed Bonus
- "Start" → timer starts, before photo prompt → `in_progress`
- Timer persists across navigation (Zustand/localStorage)
- Live display: "Timer: 12:34 / Est: 30:00", pause button
- "Mark Done" → after photo → speed bonus calculated
- Speed Bonus = floor((estimated - actual) / estimated * base_points * 0.5), capped at 50%, min 2 min actual
- Timer optional — can skip Start and just tap Done

### Household Announcements
- Dashboard banner, priority levels (normal/important/urgent)
- Created by parents or roommates, optional expiry
- Multiple can exist, most recent pinned shown

### Data Export
- CSV (completions), PDF (fairness), JSON (full backup)
- `/api/export?type=completions&format=csv&start=...&end=...`

### Fixed Assignment (No Rotation)
- rotation_type = 'fixed', single member in member_order
- "Always assigned to..." dropdown in chore settings

### 404 and Error Pages
- Custom dark-themed not-found.tsx and error.tsx

### Terms of Service & Privacy Policy
- `/terms` and `/privacy` with placeholder legal text, proper structure

### Feedback / Support
- Form: subject dropdown, message, optional screenshot → emailed to SUPPORT_EMAIL

### Rich Member Profiles
- Photo: upload/camera, crop-to-square, compress to 500KB, `avatars/{household_id}/{user_id}.jpg` (public)
- Default avatar: initials on colored background (favorite_color)
- Fields: display name, photo, bio (200 char), birthday, favorite color (12-color palette), payment handles, away status
- Age auto-calculated from birthday

### Birthday & Special Events
- Daily cron checks birthdays (household timezone)
- Birthday Day: banner (confetti/balloons), Birthday Pass (skip chores, no penalty), Gift Points button, activity feed, push notification, "Birthday Star" badge
- Household Anniversaries: 1 year banner, member join anniversaries at 6mo/1yr
- Household Milestones: 100/500/1000/5000/10000 completions, Zero Overdue Week, Full House, Perfect Month, 1/3 Year Strong

### Point Gifting
- "Gift Points" on profiles → modal (recipient, amount, note, type: General/Thank You/Birthday/Bonus)
- Deduct/add, activity feed, push notification
- Family: parents free, kids to siblings (toggle-able). Roommate: anyone.

### Settle Up — Payment & Promise Tracking
**Complete ledger for money AND non-monetary rewards.**

**Payout Types:** money, treat, gift, privilege, experience, custom

**How settlements are created:**
1. Goal Completion (auto): monetary → money payout; non-monetary → parent selects type
2. Reward Redemption (auto): kid redeems → settlement for parent to fulfill
3. Competition Stakes (auto): parsed from stakes_description
4. Manual Entry: any member creates (roommate IOUs, parent promises)
5. Recurring Allowance (auto weekly): if kid meets threshold → settlement created

**Settle Up Page (`/settle-up`):**
- Balance Summary per member pair (money: net balance; non-money: count)
- Pending list with payout type icons, descriptions, amounts, source badges
- Settled history
- Create button, filter tabs (All/Money/Treats/Privileges/Experiences), export

**Settle Up Modal:**
- Money: payment method selection (Venmo/PayPal/CashApp/AppleCash/Cash/Other) with deep links → "Mark as Paid"
- Non-money: simple "Mark as Fulfilled" with optional note → `settled_via = 'in_person'`
- Both: creditor can confirm, "Forgive" button (waives obligation)

**Dashboard Widget:** "You owe $35 to Mom" or "Mom owes you: Ice cream trip!"
**Member Profile:** pending section per member pair

**Allowance Configuration (Family, Settings):**
- Per-kid: enable, money OR non-monetary type, amount/description, threshold %. Weekly cron auto-creates settlements.

### Kudos / Reactions on Activity Feed
- 👍 ❤️ 🔥 ⭐ 👏 buttons per entry, toggle, counts, stored in reactions jsonb

### Bonus Challenges
- Types: Double Points (multiplier), Completion Count (target + bonus), No Overdue (household-wide), Custom
- Countdown, progress, one double-points at a time

### Shared Shopping / Supply Lists
- Multiple lists per household (default "Groceries" auto-created)
- Quick-add with auto-categorization, category grouping, real-time checkbox sync
- "Need supplies?" link on chore completion
- Recurring items: auto-add rules in `recurring_items` jsonb

### Assignment Comments / Notes Thread
- Chronological thread on each assignment, 500 char, 50 max
- Real-time via Supabase Realtime, push notifications

### Custom Achievements / Parent-Created Badges
- Create: name, description, icon (40 Lucide icons), color, criteria type (manual/chore_count/category_count/streak/speed_bonus_count/points_total) + target
- Auto-check on completions for automatic types
- Display alongside system badges on profiles

### Chore Bundles / Deep Clean Groups
- Group multiple chores, assign to member(s), single due date
- Split or full-bundle assignment modes
- Master progress bar, +10% bundle completion bonus

### Quick Tasks / One-Off To-Dos
- Inline add, optional assign + due date, no points/gamification
- Single tap complete, "promote to chore" suggestion for recurring

### Year-in-Review
- Annual stats: total completed, MVP, most consistent, speed demon, busiest/slowest month, most popular/avoided chore, streak record, settlements, W-L records, fun facts
- Animated slideshow (Framer Motion), shareable image cards, past-year archive

### Smart AI Suggestions
- Weekly via generate-reports cron, GPT-4o analysis of 2 weeks of data
- 3-5 actionable suggestions with action buttons + dismiss
- Dashboard "AI Insights" card, cost cap shared with photo verification

### Referral Program
- Auto-generated `MANYHANDZ-XXXX` codes per household (max 10 uses)
- Share: copy, link, QR code
- Both households get 1 free month (Stripe credit)
- Dashboard in Settings with stats + history

### Subtasks / Chore Checklists
- Steps on chore create/edit: inline add, drag reorder, stored as `chores.checklist` jsonb
- During completion: checkboxes, progress bar, real-time sync to `assignments.checklist_progress`
- Optional gating: "Require all steps" setting
- Templates include pre-built checklists

### Snooze / Postpone Assignments
**Immediate (no approval):** first snooze before due date, OR adult (parent/roommate)
**Requires parent approval (family kids):** already overdue OR second+ snooze
- Snooze modal: reason (300 char), new date/time (presets: later today, tomorrow, weekend, custom)
- Appears in parent approval queue
- **Guardrails:** max 3 snoozes, max 7 days past original, approved overdue snooze restores streak

### Share-to-ManyHandz (Web Share Target)
- PWA manifest `share_target` → `/share-intake` page
- Text sharing: AI parses into shopping items / quick tasks / chore assignments
- Image sharing: routes to Photo-to-Task
- URL sharing: creates quick task with URL
- Preview with edit before saving

### Photo-to-Task (AI Camera Capture)
- Mode 1: Messy room → chore with subtasks, difficulty, time, category
- Mode 2: Empty shelf → shopping items
- Mode 3: Receipt → check off matching items
- AI cost display, preview before saving

### Notification Quick Actions
- Service worker action buttons on push notifications:
  - Approval: [✓ Approve] [Review]
  - Chore Assigned: [▶ Start Now] [⏰ Postpone]
  - Overdue: [Do It Now] [⏰ Postpone]
  - Snooze Request: [✓ Approve] [✗ Deny]
  - Poll: [Vote Now]
- Service worker fetch() to API routes, progressive enhancement fallback

### Household Health Score
- 0-100 composite from 5 components (each 0-20):
  1. Completion Rate (% on time last 7 days)
  2. Fairness Balance (deviation from ideal)
  3. Streak Health (avg current streak)
  4. Overdue Count (currently overdue)
  5. Engagement (activity events last 7 days)
- Labels: 90-100 Excellent, 75-89 Great, 60-74 Good, 40-59 Needs Work, 0-39 Struggling
- Recalculated hourly (1hr cache) + weekly by cron
- Dashboard hero widget with gauge, breakdown, trend sparkline

### Household Polls / Quick Votes
- Create: question (200 char), 2-6 options, allow multiple, anonymous, auto-close time
- Voteable cards on dashboard + feed, real-time vote bar charts
- Close manually or at `closes_at`

### Smart Recurring Detection
- Weekly cron pattern analysis (4 weeks):
  - Repeated shopping items → suggest auto-add
  - Repeated quick tasks → suggest chore promotion
  - Schedule optimization (via AI)
  - Difficulty/time calibration
- Results in AI Suggestions dashboard widget

### Head-to-Head Competitions
- Types: Most Points, Most Completions, First to Target, Specific Chore Race
- Stakes: points wager (escrow) + optional real-world description
- Flow: create → opponent notified → accept/decline (24hr expire) → live progress → winner determined → stakes transferred
- Dashboard "VS" card with avatars, scores, countdown
- Badges: Challenger, Victorious, Undefeated, Rival, High Roller

### Reference Photos (Gold Standard)
- Upload per chore, compressed to 500KB, `chore-references/{household_id}/{chore_id}.jpg`
- Shown on: chore card (thumbnail), assignment card ("The Goal"), assignment detail (prominent), approval queue (3-up: Reference|Before|After), chore detail ("The Standard")
- AI integration: included as 3rd image, returns `reference_match_score`
- "Use as reference" from approved completion

### AI-Powered Photo Verification
- Triggers when completion has before+after photos and chore has AI enabled
- 3-photo prompt (with reference) or 2-photo prompt (without)
- Confidence scoring → auto-approve (≥85), flag (40-84), auto-reject (<40)
- Per-household settings: master toggle, per-chore toggle, provider, thresholds, cost cap
- Fallback to manual on AI failure
- Cost tracking in `ai_verifications.cost_cents`

### Theme / Accent Color Picker
- 12 colors: Indigo, Violet, Rose, Pink, Amber, Emerald, Cyan, Blue, Orange, Lime, Fuchsia, Sky
- Applies to: avatar ring, name in feed, chart bars, calendar columns

### Quick-Add Chore from Dashboard
- Inline input bar: "Quick add a chore..." + Enter → creates with smart defaults (difficulty 3, 15 min, General)

### Onboarding Walkthrough
- Step-through tooltip tour (4 stops), dismissible, one-time, replayable from Settings

---

## CORE ALGORITHMS

### Fairness Score (`lib/utils/fairness.ts`)
```
For each member in household over date range:
1. Sum completion points (difficulty * estimated_minutes / 15)
2. Calculate total household points
3. Member fairness % = (their points / total) * 100
4. Ideal share = 100 / active_member_count
5. Deviation = member % - ideal %
6. Within ±5% = Balanced (green), 5-15% = Slightly off (amber), >15% = Significantly off (red)
Exclude penalty-free skips (Birthday Pass, Vacation) from fairness.
```

### Auto-Rotation (`lib/utils/rotation.ts`)
```
For each active rotation group:
1. Check if period ended (based on frequency)
2. fixed: always assign member_order[0]
   round_robin: advance current_index (wrap)
3. Create new assignment
4. Skip inactive/away members. If all unavailable, skip period.
```

### Points (`lib/utils/points.ts`)
```
Base = difficulty * (estimated_minutes / 15)
Streak bonus = +10% per consecutive day (cap +50%)
Early completion = +5 if before due time
Photo proof = +2 (before+after = +4)
Speed bonus = floor((est - actual) / est * base * 0.5), cap 50%, min 2 min actual
Challenge multiplier if active double_points challenge
Points are integers, round up.
```

### XP & Leveling (`lib/utils/levels.ts`)
```
XP = points earned (cumulative, never decreases)
Level thresholds: 1:0, 2:50, 3:120, 4:200, 5:350, 6:500, 7:700, 8:1000,
  9:1300, 10:1700, 15:4000, 20:8000, 25:14000, 30:22000, 40:45000, 50:80000
Titles: 1-4 Rookie, 5-9 Helper, 10-14 Contributor, 15-19 Household Pro,
  20-29 Chore Master, 30-39 Household Legend, 40-49 ManyHandz Elite, 50+ Hall of Fame
Level up: full-screen celebration, push notification, activity feed
```

### Payment Links (`lib/utils/payment-links.ts`)
```
Venmo: venmo://paycharge?txn=pay&recipients={handle}&amount={amount}&note={note}
PayPal: https://paypal.me/{handle}/{amount}
Cash App: https://cash.app/${handle}/{amount}
Apple Cash: no deep link — display phone, "Send via iMessage"
Returns: { url, fallbackUrl, platform }
```

---

## STRIPE SUBSCRIPTION SYSTEM

| Tier | Price | Features |
|---|---|---|
| FREE | $0 | 14-day auto-trial, then read-only |
| STANDARD | $9.99/month or $99.99/year | Full access |

**Flow:** Signup → trial (14 days) → Subscribe (Stripe Checkout) → Active → managed via Customer Portal

**Trial Expired:** Read-only mode. Can view all data. Cannot create/complete/redeem. Persistent paywall. DB-level enforcement via `household_has_active_subscription()` RLS.

**API Routes:**
- `POST /api/stripe/create-checkout` — creates Stripe Checkout session (monthly or annual price_id)
- `POST /api/stripe/create-portal` — creates Customer Portal session
- `POST /api/stripe/webhook` — verifies signature, handles: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted, invoice.payment_succeeded, invoice.payment_failed. Uses **service client** for DB writes.

---

## PUSH NOTIFICATIONS & SERVICE WORKER (Serwist)

Service worker at `src/app/sw.ts` → `public/sw.js` via `@serwist/next`.

**`next.config.ts`:** withSerwist({ swSrc: 'src/app/sw.ts', swDest: 'public/sw.js' })

**sw.ts includes:** precaching (self.__SW_MANIFEST), runtime caching (NetworkFirst API, CacheFirst static), navigation preload, push handler with action buttons, notificationclick handler, Web Share Target handler.

**Notification types (push + email where noted):** Chore Reminder, Overdue Alert (+email), Chore Completed, Approval Needed (+email), Approval Result, Swap Request/Result, Reward Redeemed, Goal Milestone, Goal Completed (+email), Achievement Unlocked, Level Up, Announcement, Weekly Digest (email only), Comment, Custom Badge, Bundle Completed, Snooze Request/Approved/Denied, Poll Created/Results, Recurring Item Added, Referral Reward (+email), Trial Ending (+email), Payment Failed (email only), Welcome (email only).

---

## REAL-TIME FEATURES (Supabase Realtime)

Subscribe to: activity_feed, assignment status, approval queue, goal progress, level-ups/achievements, shopping lists, assignment comments, quick tasks.

Implement via `useRealtime` hook managing subscriptions and cleanup.

---

## CRON ENDPOINTS (all protected by CRON_SECRET header)

- **`/api/cron/rotate-assignments`** — advance rotation groups, create new assignments
- **`/api/cron/check-overdue`** (hourly) — mark past-due as overdue, reset streaks, fire alerts
- **`/api/cron/check-birthdays`** (daily) — birthday detection, pass, notifications
- **`/api/cron/check-challenges`** (hourly) — challenge expiry/completion
- **`/api/cron/check-competitions`** (hourly) — competition resolution, stakes transfer
- **`/api/cron/generate-reports`** (weekly Sunday) — per-member stats, letter grades, MVP, allowance auto-creation, AI suggestions, smart recurring detection, health score recalculation, recurring shopping items, auto-close expired polls

---

## MIDDLEWARE & AUTH

`src/middleware.ts` uses `updateSession()` from `@supabase/ssr`:
1. Refresh Supabase auth token on every request
2. Check valid session on `/(app)/*` routes → redirect to `/login` if none
3. No household → redirect to `/onboarding`
4. Expired subscription → set `x-subscription-status: expired` header (UX layer; DB RLS is authoritative)
5. Allow unauthenticated: `/`, `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/callback`, `/api/auth/webauthn/*`
6. Redirect authenticated from `/login`/`/signup` to `/dashboard`
7. Always allow `/billing` and `/api/stripe/*`
8. Set security headers on every response

### WebAuthn / Passkey Flow
- Registration: POST register-options → startRegistration() → POST register-verify → store credential
- Authentication: POST login-options → startAuthentication() → POST login-verify → create session
- Settings: list/rename/delete passkeys

---

## SECURITY

### Security Headers (middleware)
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=()
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com; frame-src https://js.stripe.com; font-src 'self'
```

### CSRF: token per session in httpOnly cookie, verify x-csrf-token header on POST/PUT/DELETE. Exempt webhook routes.
### Webhooks: Stripe signature verification, Supabase webhook verification.
### Input: Zod validation on all API inputs. File type/size validation.

---

## SUPABASE STORAGE

| Bucket | Visibility | Max Size | Path | Purpose |
|---|---|---|---|---|
| `avatars` | Public | 5 MB | `{household_id}/{user_uuid}.{ext}` | Profile photos |
| `chore-references` | Private | 10 MB | `{household_id}/{chore_uuid}.{ext}` | Reference photos |
| `proof-photos` | Private | 10 MB | `{household_id}/{assignment_uuid}/{type}.{ext}` | Before/after photos |

Private buckets use signed URLs (60s TTL). All paths scoped to `{household_id}/...`.

---

## ANIMATIONS & MICRO-INTERACTIONS

- Completion: confetti (family) or checkmark (roommate)
- Points: floating "+X pts" / "+X XP"
- Level up: full-screen overlay (3s auto-dismiss)
- Achievement: toast with badge icon slide-in
- Goal progress: animated ring fill, confetti at 100%
- Fairness gauge: animate fill on load
- Streak: fire icon intensity scales with length
- Cards: subtle scale on hover/press
- Page transitions: fade/slide (Framer Motion)
- Loading: skeleton screens (not spinners)
- Pull-to-refresh on mobile
- Shopping check-off: strike-through + slide to checked section
- Bundle completion: confetti + progress bar fill
- Custom badge: glow effect reveal
- Year-in-Review: counting numbers, card transitions, confetti on MVP
- Health score: animated gauge fill, number count-up
- Poll voting: bar width animation, "voted" checkmark
- Share intake: shimmer loading, items slide-in
- Photo-to-task: scanning animation
- Respect mute_celebrations preference

---

## ERROR HANDLING

- All API calls: try/catch with Sonner toasts (toast.success/error/loading)
- Optimistic updates for completion marking (rollback on error)
- Offline detection banner
- Empty states with custom messaging for every section
- Rate limiting awareness
- Image upload: compress before upload (avatars 500KB, others 1MB), progress bar

---

## ADDITIONAL REQUIREMENTS

1. Fully responsive (375px, 390px, 768px, 1440px, Capacitor WebView)
2. Accessible (ARIA, keyboard nav, color contrast)
3. SEO (meta tags, OpenGraph on landing)
4. Performance (Next.js Image, lazy load, React.memo, Serwist precaching)
5. TypeScript strict (no `any`)
6. Code organization (components <200 lines, hooks for logic, barrel exports, queries in `lib/supabase/queries/*.ts`)
7. Stripe security (webhook verification, server-side only, DB-level enforcement)
8. Service worker (Serwist, action buttons, share target)
9. Payment handles (optional, deep links only, no financial credentials)
10. Security headers on every response
11. shadcn/ui throughout, Sonner toasts, next-themes
12. Three Supabase clients (browser, server, service — service never in client code)
13. README.md with complete setup instructions
