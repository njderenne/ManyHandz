# `worker/engines/` — the pure-engine convention

Every module in this directory is a **PURE, deterministic, DB-free** function library with typed
inputs. Four fleet apps converged on this shape independently — this directory canonizes it:

- **pet-pilot** `worker/routes/insights-engine.ts` — deterministic rule-based insights ("AI
  Insights" in the UI, zero LLM calls; the route fetches + org-scopes rows, the engine only maps
  rows → output).
- **RxMndr** `worker/lib/scheduling.ts` + `worker/routes/reports.ts` — schedule expansion and
  range-metrics math as pure functions whose tests ARE the spec.
- **ManyHandz** `src/lib/manyhandz/rotation.ts` — fairness/rotation resolution as a pure function
  the cron drives; the cron owns all persistence.
- **keepsey** `worker/prompts/catalog.ts` — a versioned in-code prompt catalog with a
  deterministic selector shared by the route and the cron, so the two can never disagree.

## The rules

1. **Pure.** An engine function's output depends only on its arguments. No hidden clocks
   (`Date.now()` inside the body) — `now` is always an injectable argument or option. No
   `Math.random()` in anything that feeds persistence or assertions.
2. **Deterministic.** Same inputs → same output, byte for byte. Ties are broken by stable sorts
   (usually id order), never by insertion luck — two Workers computing the same answer is a
   correctness property, not a nicety.
3. **DB-free.** Inputs are **plain rows** (already fetched, already org-scoped by the caller).
   Engines never import `@/lib/db`, `drizzle-orm`, `hono`, or the Worker `Env`. Routes and cron
   do ALL I/O: fetch rows → map to the engine's input shape → call the engine → persist/serve.
4. **Tested.** Every engine ships a `.test.ts` sibling. Because the functions are pure, the tests
   need no mocks and double as the module's specification.
5. **Derive, never store.** Derived values (streaks, leaderboards, summaries) are computed at
   read time from source-of-truth rows — the Project Gains lesson: a stored derivative is a
   consistency bug waiting for a missed write.

Rules 1–3 are enforced mechanically by `purity.test.ts` (a source grep — cheap and durable).

## Sanctioned exceptions (thin I/O shells, contract-pinned)

Two entry points live here **because the STAGE0 §9 contract registry pins their file**, and each
is a thin I/O shell wrapped around a pure core in the same module:

- `nudge.ts` → `sendPromptNudges(env)` — the cron body. The pure core (`PROMPT_CATALOG`,
  `selectPrompts`, `isDueState`, `runPromptNudges`) does all the deciding; the shell only reads
  due rows, advances windows, and fans out via `notify()`.
- `catalog-seed.ts` → `seedCatalog(db, items, version)` — the idempotent versioned seeder. The
  pure core (`planSeed`) does all the classifying; the shell only reads existing rows and writes
  the plan.

These two files may import `@/lib/db` / `Env`; nothing in this directory may import `hono`
(routes never live here). `purity.test.ts` encodes exactly this allowlist.

## Naming & placement

- One domain per file: `worker/engines/<domain>.ts` (`rotation.ts`, `range-metrics.ts`, …).
- **App engines go here too.** A minted app adds `worker/engines/<its-domain>.ts` following the
  same rules; the purity test picks new files up automatically (add I/O shells to its allowlist
  only when a contract genuinely pins them — prefer keeping I/O in routes/cron).
- Loaders (the thin functions that fetch rows and shape them into engine inputs) live with their
  caller: route-file registries (`reportLoaders` in `worker/routes/generated-reports.ts`) or the
  cron step — never in this directory.

## The reference engines

| File | Pattern it canonizes | Donor |
|---|---|---|
| `streak-points.ts` | Derive-never-store: streak + points summaries computed from raw event/ledger rows at read time | Gains lesson, complements `worker/streaks.ts` |
| `rotation.ts` | Fairness rotation with deterministic tie-breaks | ManyHandz chore rotation |
| `insights.ts` | Deterministic rule-runner skeleton — "insights" without a model call | pet-pilot insights engine |
| `nudge.ts` | In-code prompt catalog + gentle cadence-windowed nudge cron | keepsey prompts |
| `catalog-seed.ts` | Idempotent, version-watermarked global-catalog seeder | grindline seed mechanism |
| `range-metrics.ts` | Generic range-metrics report math (the `generated_report.data` DTO) | RxMndr doctor reports |
