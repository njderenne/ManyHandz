# PRODUCT_BRIEF — ManyHandz

> The product ground truth for this app. BUILD is the mandate, PARKED is the backlog, NEVER is
> the law. Agents: check every feature proposal against NEVER before starting work; promoting
> between zones requires a signed revision in the version log. See builder/research/README.md.

## Version log

| v | Date | Dial | Change | Approved by |
|---|---|---|---|---|
| 1 | 2026-06-20 | Comprehensive | Initial brief. Promoted PARKED→BUILD (📌, wlarson): AI assistant, meal planning, data export. Brand set to coral #FF6B4A. Native +biometric-app-lock +QR-join. | wlarson |

<!-- Pins live in TWO places: the version-log entry above AND a 📌 on the feature's zone-table
     row. A pinned row is immovable without a new logged approval — agents check both. -->


## Thesis

ManyHandz is one config-driven chore app that serves **two households the category forces you to
choose between**: Family mode (parent/kid, gamified, photo-approval workflow) and Roommate mode
(equal adult peers, fairness-first honor system, settle-up ledger). The wedge is being the
**maintained, reliable, mode-aware successor to the apps people already abandoned** — OurHome rotted
into abandonware (delisted iOS, unpublished from Google Play Sep 2023, sync/points broken), and Cozi
torched trust with a 2024 paywall that held users' own data hostage. Nobody credibly serves both
modes in one product; the market is split into "kids apps" (OurHome, S'moresUp) vs
"couples/roommate apps" (OurFlat, Flatastic, Homsy). At the **Comprehensive** dial, ManyHandz's
identity is the union of the best of both worlds — gamification *and* effort-weighted fairness,
photo-verify *and* settle-up — held together by a single mode switch, executed reliably where the
incumbents decayed. Restraint here is not the brand; **breadth executed well, and never repeating
the incumbents' trust-killers,** is.

**Seed:** "ManyHandz — a household chore-management app for families and roommates: assign +
auto-rotate chores, score fairness (effort-weighted by difficulty × time), photo-verify completion
(optionally AI-checked), and gamify it for kids (points/XP/levels/badges/rewards/goals). One
config-driven product with a Household 'mode' (Family = parent/kid, gamified, approval workflow;
Roommate = equal peers, fairness-first honor system). Also: Settle-Up ledger for money + non-money
IOUs, head-to-head competitions, shopping lists, polls, announcements, household health score,
year-in-review. Single plan $9.99/mo or $99.99/yr, 14-day no-CC trial, read-only on expiry."

**Competitor reactions:** admires **OurHome** for gamified points/rewards + rotation + free
all-in-one (but its abandonment since ~2020 and broken sync are the opening); admires **Cozi** for
its loved shared color-coded calendar + shopping lists (but rejects its 2024 paywall "bait and
switch," intrusive free-tier ads, and flat no-assignment chore list); admires **Tody/Sweepy** for
completion-dopamine, room/dirtiness models, and effort-points (but rejects their coarse 1–3 fairness
proxy, single-user-gated free tiers, and cleaning-only scope that can't serve a family or roommate
group).

## Competitive landscape (summary)

| App | Position | Loved for | Hated for | Price |
|---|---|---|---|---|
| **OurHome** | Free gamified family chore leader; closest comp to Family mode — but abandonware since ~2020 | Points/rewards that motivate kids; rotation; free all-in-one | Abandoned; broken Android sync; points stop syncing (kids lose progress); delisted/unpublished; no fairness weighting; no photo proof; mobile-only | Free (no revenue model — cause of its decay) |
| **Cozi** | Category-leading family *organizer* (12M+ families); calendar-first, chores are a flat list | Shared color-coded calendar; real-time shared shopping list | 2024 paywall "bait and switch" (30-day calendar cap, data held hostage, ~2.1 Trustpilot); intrusive free-tier ads incl. injected into your list; no per-person/rotation chores | Free w/ ads; Cozi Gold ~$39/yr |
| **Tody** | Best room-by-room cleaning tracker; time-decay "dirtiness" model; solo/couple, not a fairness system | Completion dopamine + progress; reduces mental load (remembers what's due); cost-friendly, no forced paywall | Cleaning-only; one-time→subscription shift gated cross-device sync behind Premium | Free; Premium ~$30/yr (sync gated to paid) |
| **Sweepy** | Best-rated pure cleaning app; effort-points (1–3) + leaderboard + AI scheduler; multi-user feels bolted on | Effort-matched daily load (ADHD-friendly); streaks; rooms; kid-vs-parent leaderboard | Coarse 1–3 effort proxy (1hr shovel = 3pts, 30s light switch = 1pt); free tier is single-user; basic features behind paywall | Free (single user); Premium ~$2.49/mo or ~$13–15/yr |
| **Maple** | AI-first all-in-one family assistant (calendar, email→task, chores, meals, lists) | All-in-one consolidation; clean design; no required subscription | "Error updating" sync bugs that lose entries; near-useless fixed reminders; no support for phone-less members; chore tracker "immature" | Free w/ premium (~$76/yr) |
| **OurFlat / Flatastic** | Roommate-first all-in-ones — chores + bill-splitting + lists + polls/pinboard | Bundling chores + money settle-up + group decisions; offline | Round-robin (not effort-weighted) rotation; not built for kid gamification | Free w/ premium |
| **Splitwise (adjacent)** | Category leader for who-owes-whom settle-up + debt simplification | Running balances; "simplify debts" untangles debt triangles | Debt-simplification is a confusing "black box," on by default | Free (limited); Pro |
| **Chorsee / Homey / ChoresAI (adjacent)** | Newer entrants built around photo proof + (ChoresAI) AI photo verification | Photo proof for "less-than-honest kids"; AI instant approve | Photo-proof is now near table-stakes among new apps, not a moat; tiny install bases | Freemium / sub |

**Holistic player?** No incumbent credibly spans Family *and* Roommate in one config-driven
product. OurHome is parent-to-child gamified (awkward for adult peers; weakens above 3 people);
OurFlat/Flatastic/Nipto skip kid gamification; Cozi/Maple treat chores as an afterthought; Tody/Sweepy
are cleaning-only. **The gap ManyHandz occupies:** a single, *maintained* product that mode-switches
between gamified family approval and fairness-first roommate honor system, with effort-weighted
(difficulty × time) fairness and a settle-up ledger spanning money *and* non-money IOUs — the
best-of-category union the split market never assembled.

## BUILD (v1)

> Comprehensive dial: best-of-category union anchored on the seed's must-have (mode-aware chores +
> effort-weighted fairness + gamification + photo-verify + settle-up). All verified loved/wished
> clusters and all table-stakes land here. Catalog modules cited from FEATURE_CATALOG.md; unmapped
> = CUSTOM with an S/M/L cost guess.

| Feature | Evidence | Catalog module | Cost |
|---|---|---|---|
| Mode switch (Family ↔ Roommate) — config-driven identity, drives gamification/approval vs honor-system/fairness defaults | wished, comparison: no incumbent serves both modes; OurHome "awkward for adults," roommate apps skip kid gamification — the core bet | Config-driven identity (core) + CUSTOM mode logic | M |
| Chore assignment — to one, several, or up-for-grabs; restrict tasks/rooms to specific people | table-stakes, every app; wished (store-reviews, Sweepy/Tody room-first → want person-first ownership) | CUSTOM (chore engine) | M |
| Auto-rotation that survives missed days / vacations (Away/Pause mode + fairness recalc, no full reset) | hated, store-reviews (Tody "chore-debt on return"; Chorsee rotation doubling/missing; roommate stealth-redistribution breeds resentment) | CUSTOM (rotation engine) | M |
| Recurring tasks reschedulable from completion date OR original due date (per-chore, ungated) | wished, category-level (Todoist every/every!; Tody decay-from-last-done; OurHome gates completion-reschedule to overdue only) | CUSTOM (recurrence) | S |
| Effort-weighted fairness scoring — automatic difficulty × time (not raw count or coarse 1–3) + contribution/visibility charts | wished/loved, store-reviews + market (Sweepy's 1–3 proxy widely criticized; Tidywell/Nipto/evenus compete on effort; Pew/Harvard invisible-labor grounding) — automation is the edge, not novelty | Gamification (credit_ledger, derived) + Charts + CUSTOM scoring | L |
| Gamification — points/XP/levels/badges/rewards/goals; **age-/mode-tunable** (rich for young kids, restrained/off for teens + Roommate) | loved (store-reviews, OurHome/Sweepy/Nipto/S'moresUp/Joon) — the defining kid motivator; table-stakes for Family mode | Gamification (credit_ledger + achievement_unlock) | M |
| Points → real-privilege rewards economy (screen-time, allowance, pizza-night pick), parent-defined; tunable/disable-able | loved (store-reviews, OurHome/S'moresUp/Joon) — real, moderate cluster; pair with contribution framing to dodge reward-fatigue | Gamification + CUSTOM reward catalog | M |
| Completion satisfaction — mark-done dopamine + visible progress + streaks (DERIVED, never stored) | loved (store-reviews, Tody/Sweepy; Gains "derive-at-query" lesson) | Gamification (derived streaks) + CircularProgress (core UI) | S |
| Photo-verify completion + parent/admin approval queue (Family) / honor-system relief (Roommate) | wished, store-reviews (Chorsee "photo proof for less-than-honest kids") — expected parity vs Cozi/Tody/OurHome, NOT a moat | Camera/photo capture + CUSTOM approval queue | M |
| Optional AI photo-check of completion | loved/listing (ChoresAI "AI analyzes chore completion"; ChoreSplit) — near-frontier but already exists; ship as optional, not the wedge | OCR/AI vision (Worker) + AI provider abstraction | M |
| Approval workflow (Family) — parent reviews → awards points; reliable (OurHome's is buggy) | table-stakes, store-reviews (OurHome approval defining but "Sorry we can't do that" bugs) | CUSTOM (approval state) | S |
| Smart, person-targeted, escalating reminders/nudges with non-push fallback ("app is the bad guy") | loved/wished/hated, comparison + store-reviews (getchares "let the app be the bad guy"; OurHome/Cozi/Maple reminders broken or fixed-offset) — reliability + targeting, not just "more dings" | Escalating reminders + Push notifications + SMS fallback | M |
| Settle-Up ledger — who-owes-whom running balances + **transparent, optional** debt simplification (Roommate) | loved (store-reviews/adjacent, Splitwise category leader) — absent from the 5 named comps; expose underlying IOUs (Splitwise "black box" complaint) | P2P payment handles + CUSTOM ledger | L |
| Non-money IOUs (favors/turns owed) in the same ledger | wished, comparison — no surveyed app extends settle-up to non-money IOUs (differentiated combo) | CUSTOM (extends ledger) | S |
| Head-to-head competitions / weekly leaderboard + winner-picks-reward — **optional & soft in Roommate** | loved (store-reviews, Nipto/Sweepy/OurHome) — validated as leaderboard loop (not literal 1v1); skews family/kids, reward-fatigue counter-cluster → keep optional | Gamification (derived leaderboard) + CUSTOM comp | M |
| Shared shopping/grocery + to-do lists everyone can add to | loved/table-stakes (store-reviews, Cozi "strongest feature for years"; OurHome/Maple/Flatastic ship it) | CUSTOM (shared lists) | M |
| Shared household calendar (color-coded per member) + add-to-device | table-stakes/loved (Cozi flagship; Maple) — chores surface on it; ManyHandz consolidates selectively | In-app calendar/scheduling (calendar_event) + Calendar—add to device | M |
| Polls + announcements / pinboard for the household (Roommate group decisions) | loved (listing, OurFlat "chat with polls"; Flatastic pinboard) — absent from the 5 named comps | Member messaging (message table) + CUSTOM polls | M |
| Household health score (composite: fairness + completion + on-time + engagement) | seed must-have; supported by visibility/fairness clusters — "make the invisible visible" | Charts + CUSTOM scoring | M |
| Year-in-review (annual recap: contribution, streaks, fairness, top chores) | seed must-have; rides completion/visibility clusters; engagement/retention surface | Charts + CUSTOM recap | M |
| Room/location organization + per-task frequency; optional "dirtiness"/last-done urgency model | loved (store-reviews, Tody/Sweepy signature) — strong in cleaning adjacency; offer as opt-in layer | CUSTOM (room model) | M |
| Members without their own phone / shared-device participation (named members, watch-only kids, toddlers) | wished, store-reviews (Maple anchor + category; Chorsee/Homey/Family Tools build it) — don't assume one login per person | CUSTOM (proxy members) | S |
| Web/browser access alongside native (parity) | wished, comparison (OurHome knocked for mobile-only; Homsy markets web) — native-first, web secondary per stack | Web build (RN Web, core) | S |
| Generous free trial + fair single paid tier; **read-only (never destructive) on expiry** | loved/hated (Tody "no forced paywall"; Cozi paywall backlash) — reward un-nickel-and-diming; expiry must not hold data hostage | Billing (Stripe + IAP) | S |
| 📌 AI assistant — auto-plan schedules + email→task + predictive reminders | **promoted PARKED→BUILD by wlarson (v1)**; loved/emerging (Maple/Fami/Sweepy) | AI provider abstraction + CUSTOM orchestration | L |
| 📌 Meal planning — recipes + weekly meal calendar + auto grocery-list generation | **promoted PARKED→BUILD by wlarson (v1)**; loved (Cozi/Maple all-in-one cluster) | In-app calendar + CUSTOM meal planner | L |
| 📌 Data export — calendar/lists/chore history out (CSV/JSON) | **promoted PARKED→BUILD by wlarson (v1)**; hated lock-in (Cozi) | CSV import/export (core) + CUSTOM export | S |

**Zone cost (v1, 27 features):** ~70% chassis (auth, tenancy/orgs as households, billing, gamification
ledger, calendar/message/payment-handle schemas, camera, push, charts, AI, web all exist as core/opt-in
modules) · ~15 CUSTOM features (chore engine, rotation, recurrence, fairness scoring, approval,
settle-up ledger + IOUs, shared lists, polls, health score, year-in-review, room model, proxy members,
**+ AI assistant, meal planner, data export** [promoted]) — several share infra (all fairness/
leaderboard/streak features derive off the gamification `credit_ledger`; settle-up + IOUs share one
ledger; meal planner rides the calendar). Roughly **5 L + 9 M + 7 S** of custom work
**≈ 6–8 weeks of app-layer build on top of the chassis** (the 3 promotions added ~2 weeks: AI
assistant L, meal planner L, data export S).

## PARKED (considered, deferred)

| Feature | Evidence | Why parked | Promotion trigger |
|---|---|---|---|
| Invisible/mental-load dimension (planning/anticipating, not just physical task difficulty × time) | wished, **unverified** as a distinct ManyHandz feature (MIT Tech Review/Harvard cluster is real but is a *different* axis than difficulty × time) | Off the seed's difficulty × time model; difficulty × time does not capture it — separate design problem | If our own reviews ask to credit "remembering/planning," not just doing |
| Kids' banking / debit card / allowance payout (Greenlight/BusyKid-style real money to kids) | loved, **unverified** for ManyHandz (teen-money is a real market split, but a regulated, heavy build) | Heavy/regulated; teen "cash not badges" need is served by the points→real-privilege economy in BUILD first | If teen retention proves points insufficient and reviews demand cash payout |
| Realtime live co-cleaning "sprints" (Tidywell-style) | listing, **unverified** (single competitor, no user cluster) | Novelty with no demand cluster; realtime module is ☐ unbuilt | If reviews ask for synchronous shared cleaning sessions |
| Virtual-home / cosmetic rewards (decorations for streaks) | loved (Sweepy "earn little decorations"), **unverified** as a driver vs real-privilege rewards | Nice-to-have on top of the real-reward economy already in BUILD | If gamification engagement metrics favor cosmetic over real rewards |

## NEVER (anti-features — hard guardrail)

> Verified `hated` clusters. These are the trust-killers that abandoned the incumbents. Moving any
> item out of NEVER requires an explicit, logged brief revision — not a conversation.

| Anti-feature | Hate evidence |
|---|---|
| **Paywall "bait and switch"** — taking features that were free and locking them behind a sub; capping/holding your own historical data hostage on expiry | hated, **verified** (store-reviews/Trustpilot): Cozi's May-2024 30-day calendar cap + paywalled month-view/SMS, ~1 week notice, no grandfathering → "scam"/"hostage"/"blackmail," ~2.1 Trustpilot. (Drives the seed's *read-only, non-destructive* expiry, never data deletion/ransom.) |
| **Shipping abandonware** — letting sync/points/reminders silently rot and never fixing them | hated, **verified** (store-reviews): OurHome (Cape Horizon) — no real update since 2020, unpublished from Google Play Sep 2023, points stop syncing (kids lose progress), logins fail, "clearly abandoned." Reliability + active maintenance is the whole wedge. |
| **Sync failures / "error updating" that lose data or never reach other members** | hated, **verified** (store-reviews): OurHome (points/list sync broken), Maple ("error updating" crashes and deletes the just-entered item). Undermines the core multi-user promise. |
| **Crippling the free tier on the exact thing people need** — gating basic multi-user household sharing/sync behind premium | hated, **verified** (store-reviews/comparison): Sweepy free is single-user-only; Tody gates cross-device sync — recurring "too much basic functionality behind premium." (ManyHandz's single plan must keep core household sharing usable in trial, not paywall the point.) |
| **Coarse/wrong fairness scoring** — a 1-hour task scoring the same or less than a 30-second one | hated, **verified** (store-reviews): Sweepy's 1–3 effort points ("1hr shoveling = 3pts, 30s light switch = 1pt"). ManyHandz's difficulty × time must not reproduce this. |
| **Pure pay-per-chore hard-wired with no off switch** — reward economy that erodes intrinsic motivation | hated, **verified** (parenting-expert + ~50yr overjustification/SDT literature): kids ask "what do I get?" and stop when points stop. Rewards must be tunable/disable-able + blended with contribution/belonging framing. |
| **Stale platform** — no dark mode / no widget / no Apple Watch / broken notifications | hated, **verified** (store-reviews): OurHome "frozen in time"; broken reminders are "the silent killer of adoption." |
| **Intrusive ads in the app** — incl. ads injected into your own shopping list as fake "suggestions" | hated, **verified** (comparison/store-reviews): Cozi free-tier ads, list "suggestions" = embedded brand ads, data shared for targeting. (ManyHandz is paid + trial — no ad model, ever.) |
| **"App becomes one more chore (usually mom's)"** — design that just digitizes the mental load onto one admin instead of distributing it | hated, **verified** (MIT Technology Review, widely cited): "It doesn't solve the problem: that you're nagging someone else or parenting your partner." Must-design-around: fairness visibility + app-is-the-bad-guy reminders so one person isn't the sole maintainer. |
| **Forced account/login wall before any use** | hated, **unverified** (category-wide, thinner direct-quote volume) — listed as a guardrail to honor, promote to hard-NEVER only on a verified cluster; the trial must minimize sign-in friction regardless. |

## Research-proposed intake answers

| Question | Proposal | Basis | Approved? |
|---|---|---|---|
| Name | **ManyHandz** (seed name). Store-collision note: distinct from "Manyhands"/"Many Hands" charity & volunteer apps and from the chore incumbents (OurHome, Cozi, Tody, Sweepy, Maple, Nipto, Flatastic, OurFlat) — no direct chore-app collision found; the "z" spelling aids App Store/Play uniqueness and domain availability. Domain = **manyhandz.io** (owned). | Seed; no "ManyHandz" collision found | ✅ wlarson 2026-06-20 |
| Brand color + vibe | **Warm coral/amber primary (~#FF6B4A)** with a friendly-but-grown-up, high-contrast, modern feel (dark mode day-one — a verified NEVER is "no dark mode"). Vibe must read playful for Family yet not "babyish" for Roommate/teens. | Category landscape skews cool/utilitarian: Cozi (multi-color calendar), Tidywell/Homsy (teal/green fairness), Sweepy/Tody (clean blue-grey). A warm coral differentiates on the shelf and signals "household warmth" without the kiddie primary-blue of OurHome. | ✅ wlarson 2026-06-20 — coral #FF6B4A confirmed |
| Monetization split | **Single plan: $9.99/mo or $99.99/yr; 14-day no-CC trial; read-only (non-destructive) on expiry.** Note: this sits at the **HIGH end** of the category (Cozi Gold ~$39/yr, Tody ~$30/yr, Sweepy ~$13–15/yr, S'moresUp ~$80/yr; OurHome free). The no-CC trial + "serves both modes / maintained / fairness + settle-up" breadth must justify the premium. No ads, ever (verified NEVER). Keep core household sharing usable during trial (don't cripple the point — verified NEVER). | Competitor pricing above; verified paywall-resentment + free-tier-crippling clusters | ✅ wlarson 2026-06-20 — kept $9.99/$99.99 (high-end; breadth justifies) |
| Tenant alias | **"Household"** (Better-Auth organization = a Household; members = household members; roles = Owner/Parent vs Member/Kid in Family mode, equal Peers in Roommate mode). | Tenancy via Better-Auth org plugin; "Household" matches both modes naturally | ✅ wlarson 2026-06-20 |
| Native capabilities implied | **camera** (photo-verify), **push** (escalating reminders/nudges — the verified reliability wedge), **haptics** (completion dopamine), **AI** (optional photo-check, on by Worker), **calendar** (add-to-device + in-app), **charts** (fairness/health/year-in-review), **biometrics/app-lock** (kid-account / parent-PIN gating). Likely OFF: **gps/maps** (no location need), **qr** (unless used for quick household-join invites — consider), **realtime/Plaid/wearables**. | BUILD features above feed app.json permission stripping; strip location/maps to keep the store privacy profile clean. **Confirmed ON: camera, push, calendar, biometric app-lock (Face ID+PIN), QR household-join; OFF: gps/maps, audio, health.** | ✅ wlarson 2026-06-20 |

## Source appendix

> Identifiers for the clusters/threads/articles cited above — enough to re-verify any claim. All
> findings were adversarially verified per builder/research/README.md unless marked **unverified**
> (PARKED-only). Notable corrections carried into this brief are flagged.

**Loved (verified):**
- Gamified points/rewards motivate kids — Sweepy (App Store 4.7, ~10K), Nipto (4.7, ~828 / Play 4.64 ~6.2K), Joon (4.7, ~6.6K), OurHome, S'moresUp (4.3, 1,200+). *Correction applied:* neurodivergent praise concentrates in ADHD/ASD apps (Joon, PointUp), not the four named; kid-specific gamification → OurHome/S'moresUp/Joon; Sweepy/Nipto competition skews adults/teens.
- Points→real-privilege economy — OurHome (justuseapp), S'moresUp (Common Sense Media), Joon, Levelty. *Correction:* moderate (not "single most-repeated") cluster; "motivated to do boring things" is Levelty *marketing*, not a review; reward-fatigue counter-cluster → make rewards tunable.
- Completion dopamine + streaks — Tody (deirdzs, _k___) + Sweepy (cozynerd, sporkism). *Caveat:* solo cleaning-app reviewers, not multi-user coordination.
- Effort-matched daily load (Sweepy: Ehutchinson688, cozynerd) vs remembers-what's-due (Tody: mic_k1234, t.y.) — two distinct mechanisms.
- Room + per-task frequency — Tody / Sweepy ("Rooms"). Cleaning-app cluster (extrapolated to multi-person).
- Shared shopping list — Cozi (apps.apple.com id407108860; NYCattorney/AlanThomasYerkle; usecalendara "strongest feature for years"). *Correction:* re-scope to Cozi (drop Maple/OurHome as co-equal); "real-time co-edit" is marketing — real value is shared async + "never forget the one thing."
- Color-coded calendar — Cozi (4.8/391K Apple, ~4.7 Play). *Correction:* eloquent phrasing is Cozi marketing; pair with "cluttered at scale" + 2024-paywall backlash; Maple supports only the broader all-in-one thesis.
- Friendly competition/leaderboard — Nipto (NatalieM2019), Sweepy (Bkgt86, JenCo10), OurHome, Tody (Fun N Happy = contribution graph). *Correction:* "head-to-head 1v1" not validated — the loved unit is the *weekly leaderboard + winner-picks-reward*; skews family/kids → optional/soft in Roommate. Drop Flatify (marketing).
- Settle-up ledger + debt simplification — Splitwise (10M+; softwaresuggest/splitty/saashub). *Correction:* "I never fight..." is *Business Insider* press, not FT, not a store review; Maple has a basic Expense Sheet (not a who-owes-whom ledger); debt-simplification "black box" complaint → make transparent + optional.
- Simple/clean UI — OurHome/Tody/Maple/Cozi (Singingfool2u, LottieWil)/Chap/Sweepy. Table-stakes, not a differentiator; over-simplifying reads "boring"/backlash.
- Generous free / no forced paywall — **Tody** (App Store: "without a forced pay wall", "super cost friendly"). *Correction:* OurHome "100% free" is *stale blog* (now has Premium); cautionary, not a model.
- App-as-the-bad-guy reminders — getchores.app ("let the app be the bad guy"), Homsy; Dr. Joshua Coleman (expert). *Correction:* vendor-messaging trope + expert backing, not loud user voice; the "apps LACK escalation = a gap" framing is INVERTED — simpler reminders + buy-in matter more; heavy escalation can backfire.
- Make invisible labor visible / who-did-more — Pew (59% vs 6% perception gap) + Harvard Gazette + ChoresMates/FairChore/evenus/Tody-FairShare. *Correction:* flagship quote is getchores *marketing*; drop Sweepy as equity exemplar; Homsy/Tody are visibility-only (the gap).

**Wished (verified):**
- Effort/difficulty-weighted fairness — NPR (2022), MIT Tech Review (Nipto 90-10→60-40), Choreful "39%" anecdote (150k users). *Correction:* NOT white-space — Sweepy(1–3)/OurHome(pts=min)/Nipto already weight; edge = *automatic* difficulty × time vs manual; don't cite mental-load lit as validation (different axis).
- Photo-proof / honor-system fix — Pulito, RoomPals, Chore Boss, ChoreSplit, GrowTide + Nipto/Nizz/Broomies/ChoresAI. Supply-side convergence; OurHome/Tody/Cozi correctly the non-verifying incumbents; direct user-demand thinner (supply-inferred).
- Recurrence from completion date — Zoho (8+ pg thread), Todoist every/every!, Tody decay. *Correction:* OurHome instance is a single review and OurHome already offers it (gated to overdue) — frame category-wide, build both modes ungated.
- Gamification that scales for teens (cash not babyish badges) — ChoreMonster→Landra spinoff, Privilege Points, MetaFilter. *Correction:* "ChoreSplit debit card" imprecise (real card apps: Greenlight/BusyKid/GoHenry); not an OurHome-specific complaint; much framing is vendor copy.
- One app consolidating chores+calendar+lists+(money) — Cozi Chores (shipped Apr 2025 = demand→supply), OurFlat (live), Homsy "tool fatigue." *Correction:* **selective, mode-aware** consolidation — money belongs to Roommate (OurFlat already does it = occupied, not a gap); consolidation has a ceiling (don't be "everything").
- Phone-less / shared-device members — Maple (Don'tGetRokuApp 03/2022) + Cozi/OurHome + Chorsee/Homey/Family Tools. *Correction:* ~1 strong Maple anchor + category; drop "spouse can't access" (separate invite bug).
- Reliable, targeted, escalating reminders — Maple (10-min ding), OurHome (non-functional), Cozi (never fire), Sweepy. Split: reliability vs targeting; add non-push fallback (SMS/email).
- Chores + settle-up in one app — OurFlat/Flatastic bundle it; 4/5 named comps lack money (Maple has budget Expense Sheet, not a ledger). *Correction:* differentiated vs the *named five* only; not novel in the wider roommate market.

**Hated (verified → NEVER):**
- Paywall bait-and-switch / data hostage — Cozi (trustpilot.com/review/cozi.com ~2.1; usecalendara; one-week notice, no grandfathering). *Correction:* Cozi-only (Tody grandfathered legacy buyers — drop); App Store still 4.8/391K (rage is power-users); much corroboration is competitor SEO.
- Abandonware / rot — OurHome (Cape Horizon; appbrain unpublished Sep 28 2023; iTunes-API delisted; last update Oct 2020). *Correction:* distinguish from new "OurHome by Elusios" (id 6753957205); drop choresplit competitor-quotes.
- Sync failures / "error updating" — OurHome (cluster) + Maple (id1551070188; KTbeth2011, beergotmeripped). *Correction:* DROP Sweepy (4.7; one review + a feature-gap mis-cast as sync).
- Free tier crippled on multi-user — Sweepy (single-user free), Tody (sync gated). *Correction:* OurHome is the free-sharing counterexample that sets the bar.
- Coarse fairness — Sweepy 1–3 (cubbyathome; "snow=3pts, light switch=1pt"). One prominent review + positive counter-review; real cluster is the market of effort-weighting competitors.
- Reward-fatigue / overjustification — Deci 1971, Deci/Koestner/Ryan 1999 (128-study meta), Kohn, Pink + positiveparentingsolutions/noguiltmom/psychologytoday. *Correction:* NOT an OurHome-specific cluster (drop the tag — the one OurHome "kids lost motivation" review is a sync bug); some framing is vendor copy; effect strongest for already-interesting tasks → tunable, not zero.
- Stale platform / broken notifications — OurHome "frozen in time"; Sweepy Watch sync; Nipto buggy notifications.
- Intrusive ads incl. list-injection — Cozi (usecalendara, ourcal, developgoodhabits).
- App = one more chore (mom's) / "parenting your partner" — MIT Technology Review 2022/05/10/1051954 (Jamie Gravell re: Cozi; Allison Daminger "male uptake is the biggest hurdle"; 86% of Cozi users women). *Correction:* quote is Cozi-specific; MIT named Cozi/Nipto/Maple/FairShare only (generalizes to others by analogy).
- Brittle rotation through missed days/vacations — Tody "chore-debt on return" (id595339588 + dev vacation-pause reply); Chorsee doubling (Bina719; v2.8.2 fix); roommate stealth-redistribution resentment. *Correction:* DON'T cite OurHome (single review, no true auto-rotation) or Chore Chores "Away Mode" (developer marketing, no reviews) as praised — they're feature precedents.
- Pricing sensitivity / high-end positioning — Cozi Gold ~$39/yr, Chorly $9/mo·$49/yr, Tody **~$30/yr** (NOT $10 — stale), S'moresUp $79.99/yr, ChoreAI ~$9.99. *Correction:* "reward-redemption locked" is a Chorly pattern, not S'moresUp (whose complaints are bugs/UX). ManyHandz $9.99/mo is genuinely high-end.

**Hated (unverified → PARKED/guardrail-only):**
- Forced account/login wall — MyChoreBoard "no sign-in hoops" marketing; thinner quote volume (category-wide).
- No data export / lock-in — concentrated on Cozi only (usecalendara).

**Table-stakes (skip-verify by design — presence across the category):**
- Chore assignment + recurring/auto-rotating schedules (all apps).
- Shared shopping/grocery lists (OurHome/Cozi/Maple/Flatastic).
- Shared family calendar (Cozi/Maple anchors).
- Freemium-with-cheap-premium price anchor (sets ManyHandz's high-end note).
- Gamification baseline for kids (OurHome/Sweepy/Besties/S'moresUp).
- Parent approval workflow (OurHome — defining but buggy).

**Landscape pricing references:** Cozi (Free/Gold ~$39yr), OurHome (Free, unmaintained), Maple
(Free/~$76yr), Tody (Free/~$30yr), Sweepy (Free single-user/~$13–15yr), Flatastic & OurFlat
(Free/Pro), Splitwise (Free/Pro), Greenlight (~$5.99+/mo), BusyKid (~$4/mo), S'moresUp (~$80yr),
ChoresAI (~$9.99 after trial), Tidywell (~£6.99/mo·£39.99/yr), Homsy (free ≤2 members).
