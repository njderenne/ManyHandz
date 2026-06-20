import { useCallback } from 'react'
import { Platform } from 'react-native'
import Constants from 'expo-constants'
import AsyncStorage from '@react-native-async-storage/async-storage'

/**
 * LAZY native-module load — deliberately NOT a static `import * as StoreReview` at the top.
 * expo-store-review's native binding throws at IMPORT time on binaries that don't contain it
 * (requireNativeModule, not the optional variant), and this module is reachable from the home
 * screen via useCheckoutResult — a static import would crash any installed build older than the
 * dependency at STARTUP, delivered silently by OTA (the June 10 failure class). Resolving inside
 * a try/catch turns "binary too old" into a graceful no-prompt instead.
 */
function loadStoreReview(): typeof import('expo-store-review') | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('expo-store-review')
  } catch {
    return null
  }
}

/**
 * App-store review prompt — the standard "ask happy users" machinery. Call sites mark win
 * moments with `recordPositiveMoment(...)`; `maybeAskForReview()` fires the native in-app
 * review sheet (StoreKit / Play In-App Review) only once a user has demonstrably had a good
 * time. Never gate a flow on it, never await-block UI with it — the OS may silently swallow
 * the request and you'll never know.
 *
 * GATES (all must pass before the sheet is requested):
 *   - not web (React Native Web has no review sheet — hard no-op)
 *   - `StoreReview.isAvailableAsync()` (simulators, sideloads, and some OEM Androids say no)
 *   - >= 5 recorded positive moments
 *   - >= 7 days since first launch (really: since this module first ran on the device)
 *   - not already prompted for the CURRENT app version (`Constants.expoConfig.version`) — a new
 *     release re-arms the prompt, which is exactly what the stores intend. If the version is
 *     unreadable (`Constants.expoConfig` null in some bare/release configs), the prompt is
 *     SKIPPED outright — a guessed '0.0.0' would make the once-per-release stamp meaningless
 *
 * APPLE CAP — iOS allows at most 3 review prompts per app per 365 days, enforced by the OS:
 * `requestReview()` beyond the cap resolves normally but shows nothing. That's why the request
 * is fire-and-forget and why we stamp `lastPromptVersion` optimistically — there is no signal
 * for "the sheet actually appeared". Google Play applies similar (undocumented) quotas.
 *
 * CALL SITES — mark wins where the user just succeeded at something, e.g.:
 *
 *   // Screen hosting a win moment (e.g. the streak check-in screen):
 *   const { recordPositiveMoment } = useReviewPrompt()
 *   const checkIn = useStreakCheckIn()
 *   const onCheckIn = () =>
 *     checkIn.mutate({ kind }, { onSuccess: () => recordPositiveMoment('streak_grew') })
 *
 *   // Non-screen call site (e.g. the success branch of useCheckoutResult in
 *   // src/lib/billing/use-checkout-result.ts — record, then see if we've earned the ask):
 *   void recordPositiveMoment('checkout_success').then(() => maybeAskForReview())
 *
 *   // Screen that should ask on mount if the user is already eligible (e.g. an
 *   // achievement-unlocked screen, after the celebration has rendered):
 *   const { maybeAsk } = useReviewPrompt()
 *   useEffect(() => maybeAsk(), [maybeAsk])
 *
 * State lives in AsyncStorage under a versioned key — bump the key suffix if the shape ever
 * changes incompatibly. All storage I/O is serialized through a module-level queue so rapid
 * win moments (or StrictMode double-effects) can't race the read-modify-write.
 */

const STORAGE_KEY = '@review-prompt:v1'

/** Gate thresholds — tune per app, but these defaults are the industry-standard floor. */
const MIN_POSITIVE_MOMENTS = 5
const MIN_DAYS_SINCE_FIRST_LAUNCH = 7

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The canonical win moments the template ships. Open-ended (`string & {}`) so minted apps add
 * their own labels with autocomplete intact. The label documents intent at the call site (and
 * is where per-moment analytics would hook in later) — only the COUNT is persisted today.
 */
export type PositiveMoment =
  | 'checkout_success'
  | 'streak_grew'
  | 'achievement_unlocked'
  | 'task_completed'
  | (string & {})

type ReviewPromptState = {
  /** Win moments recorded since the last prompt (reset to 0 when the sheet is requested). */
  moments: number
  /** ISO timestamp anchoring the 7-day maturity gate — stamped the first time this module runs. */
  firstLaunchAt: string
  /** App version (`Constants.expoConfig.version`) we last prompted for — at most once per release. */
  lastPromptVersion?: string
}

// ---------------------------------------------------------------------------
// Storage — serialized read-modify-write so concurrent calls can't clobber each other.
// ---------------------------------------------------------------------------

let queue: Promise<unknown> = Promise.resolve()

/** Chain `op` behind every prior storage op; failures never poison the chain. */
function enqueue<T>(op: () => Promise<T>): Promise<T> {
  const next = queue.then(op, op)
  queue = next.catch(() => {})
  return next
}

/**
 * Load persisted state, healing anything malformed back to a fresh record. A fresh record is
 * persisted immediately so the 7-day clock anchors at first sight of this install, even if no
 * moment is recorded this session.
 */
async function loadState(): Promise<ReviewPromptState> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ReviewPromptState>
      if (
        typeof parsed.moments === 'number' &&
        Number.isFinite(parsed.moments) &&
        typeof parsed.firstLaunchAt === 'string' &&
        Number.isFinite(Date.parse(parsed.firstLaunchAt))
      ) {
        return {
          moments: Math.max(0, Math.floor(parsed.moments)),
          firstLaunchAt: parsed.firstLaunchAt,
          lastPromptVersion:
            typeof parsed.lastPromptVersion === 'string' ? parsed.lastPromptVersion : undefined,
        }
      }
    }
  } catch {
    // Unreadable/corrupt state — fall through to a fresh record. Worst case the user waits
    // another 7 days for a prompt, which beats crashing a win moment.
  }
  const fresh: ReviewPromptState = { moments: 0, firstLaunchAt: new Date().toISOString() }
  await saveState(fresh)
  return fresh
}

async function saveState(state: ReviewPromptState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage full / unavailable — review bookkeeping is best-effort, never user-visible.
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mark a win moment ('checkout_success', 'streak_grew', 'achievement_unlocked',
 * 'task_completed', ...). Increments the persisted counter feeding `maybeAskForReview`'s
 * >= 5-moments gate. Fire-and-forget safe (never throws); no-op on web, where the counter
 * could never be spent. Recording does NOT prompt — pair it with `maybeAskForReview()` (the
 * `useReviewPrompt` hook wires the pair for you).
 */
export function recordPositiveMoment(moment: PositiveMoment): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve()
  // Defensive validation — call sites pass literals, but a dynamic label shouldn't be able to
  // bloat storage or smuggle a non-string through.
  if (typeof moment !== 'string' || moment.length === 0 || moment.length > 64) {
    return Promise.resolve()
  }
  return enqueue(async () => {
    const state = await loadState()
    // Cap the counter: if the prompt never becomes available (e.g. sideloaded build), the
    // number shouldn't grow unboundedly forever.
    await saveState({ ...state, moments: Math.min(state.moments + 1, 9999) })
  })
}

/**
 * Request the native review sheet IF every gate passes (see module docblock). Resolves quickly
 * either way and never rejects — safe to call from effects, mutation onSuccess, or after
 * `recordPositiveMoment`. The actual `StoreReview.requestReview()` is fired without awaiting
 * (the OS animates the sheet on its own schedule and may show nothing at all — Apple caps
 * prompts at 3/year/app); we stamp `lastPromptVersion` and reset the counter in the same
 * serialized step, so duplicate calls (StrictMode, double-mounts) can't double-prompt.
 */
export function maybeAskForReview(): Promise<void> {
  if (Platform.OS === 'web') return Promise.resolve()
  return enqueue(async () => {
    const state = await loadState()

    if (state.moments < MIN_POSITIVE_MOMENTS) return

    const ageMs = Date.now() - Date.parse(state.firstLaunchAt)
    if (ageMs < MIN_DAYS_SINCE_FIRST_LAUNCH * DAY_MS) return

    // No readable app version → no once-per-release bookkeeping → skip rather than guess.
    // (Constants.expoConfig can be null in some bare/release configurations; stamping '0.0.0'
    // would either jam the prompt forever or re-arm it unpredictably.)
    const version = Constants.expoConfig?.version
    if (!version) {
      if (__DEV__) {
        console.warn(
          '[review-prompt] Constants.expoConfig.version unavailable — skipping review prompt',
        )
      }
      return
    }
    if (state.lastPromptVersion === version) return

    // Native availability last — it's the only gate that costs a bridge round-trip. A null
    // module means this binary predates the expo-store-review dependency: no-op, no crash.
    const StoreReview = loadStoreReview()
    if (!StoreReview) return
    const available = await StoreReview.isAvailableAsync().catch(() => false)
    if (!available) return

    // Fire-and-forget: never block UI on the sheet, never let a StoreKit rejection surface.
    StoreReview.requestReview().catch(() => {})

    // Stamp optimistically — there is no "sheet actually appeared" signal on either store.
    await saveState({ ...state, moments: 0, lastPromptVersion: version })
  })
}

/**
 * Hook for screens that host win moments. Returns stable callbacks (safe in effect deps):
 *
 *   - `recordPositiveMoment(moment)` — records the win, then immediately checks whether the
 *     prompt is earned (the standard wiring: ask at the peak of the user's happiness).
 *   - `maybeAsk()` — gate-check only, for mount effects on screens the user reaches AFTER a
 *     win (e.g. an order-confirmation or achievement screen): `useEffect(() => maybeAsk(), [maybeAsk])`.
 *
 * Both are fire-and-forget and StrictMode/double-mount safe — the gates and the serialized
 * storage queue make repeat calls idempotent within a version.
 */
export function useReviewPrompt() {
  const record = useCallback((moment: PositiveMoment) => {
    recordPositiveMoment(moment)
      .then(() => maybeAskForReview())
      .catch(() => {})
  }, [])

  const maybeAsk = useCallback(() => {
    void maybeAskForReview()
  }, [])

  return { recordPositiveMoment: record, maybeAsk }
}
