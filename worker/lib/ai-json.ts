/**
 * AI JSON extraction — the two primitives behind every "model → structured data" endpoint.
 *
 * Models that are asked for JSON still wrap it in prose ("Sure! Here's the data: { … }") or fence it
 * in ```json … ```. `extractJson` pulls the FIRST balanced {…} object out of such a reply and parses
 * it; `validateExtraction` turns the parsed-but-untrusted object into a typed result via a caller's
 * per-field rules — the model's output is input, so every field is defended (clamped/whitelisted/
 * defaulted), never trusted.
 *
 * Dependency-free and provider-agnostic (no AI SDK imports) so it's unit-testable and reusable from
 * any route. See worker/routes/ai-tools.ts for the worked example.
 */

/**
 * Extract + parse the FIRST balanced JSON object from a model reply. Scans for the first `{`, then
 * tracks brace depth — ignoring braces inside JSON strings (and their escapes) — to find that
 * object's matching `}`, and JSON.parses the slice between. Returns null if there's no object or it
 * doesn't parse, so callers can fail-closed (4xx/5xx) or fail-open (safe default) as they choose.
 */
export function extractJson(text: string): unknown | null {
  if (typeof text !== 'string') return null
  const start = text.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null // unbalanced — no complete object
}

/** A parsed model object as an untrusted bag of unknown fields. */
export type Extracted = Record<string, unknown>

/**
 * Per-field validators: each maps the raw (untrusted) value to the typed field value. A validator
 * is responsible for its OWN defaulting/clamping — it always returns a value (it never throws), so
 * the assembled result is fully typed and total. See the `field` helpers below for the common cases.
 */
export type FieldValidators<T> = { [K in keyof T]: (raw: unknown) => T[K] }

/**
 * Defensive extraction: parse a model reply, then run each field's validator over the parsed bag.
 * Returns the fully-typed result, or null when nothing parsed — so a FAIL-CLOSED route returns an
 * error on null while a FAIL-OPEN route falls back to a safe default. The model's output is NEVER
 * trusted: validators clamp lengths, whitelist enums, and default missing/garbage fields.
 *
 *   const result = validateExtraction(raw, {
 *     title:  (v) => field.string(v, { max: 200, fallback: null }),
 *     amount: (v) => field.number(v, { min: 0, fallback: null }),
 *     status: (v) => field.enum(v, STATUSES, 'unknown'),
 *   })
 */
export function validateExtraction<T extends Extracted>(
  text: string,
  validators: FieldValidators<T>,
): T | null {
  const parsed = extractJson(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const bag = parsed as Extracted
  const out = {} as T
  for (const key in validators) {
    out[key] = validators[key](bag[key])
  }
  return out
}

/**
 * Field-validator helpers for the common shapes (string / number / boolean / enum / array). Each
 * coerces an untrusted value to a typed one, defaulting on anything off. Compose them in the
 * `validators` map passed to validateExtraction.
 */
export const field = {
  /** A string, trimmed to `max` chars; `fallback` (default '') when absent or not a string. */
  string<F extends string | null = ''>(raw: unknown, opts: { max?: number; fallback?: F } = {}): string | F {
    const fallback = (opts.fallback ?? '') as F
    if (typeof raw !== 'string') return fallback
    return opts.max ? raw.slice(0, opts.max) : raw
  },

  /** A finite number, optionally clamped to [min, max]; `fallback` (default null) otherwise. */
  number<F extends number | null = null>(
    raw: unknown,
    opts: { min?: number; max?: number; fallback?: F } = {},
  ): number | F {
    const fallback = (opts.fallback ?? null) as F
    if (typeof raw !== 'number' || !Number.isFinite(raw)) return fallback
    let n = raw
    if (opts.min !== undefined && n < opts.min) n = opts.min
    if (opts.max !== undefined && n > opts.max) n = opts.max
    return n
  },

  /** A boolean; `fallback` (default false) when not a boolean. */
  boolean(raw: unknown, fallback = false): boolean {
    return typeof raw === 'boolean' ? raw : fallback
  },

  /** One of `allowed` (whitelist), else `fallback`. Keeps model output inside the app's vocabulary. */
  enum<E extends string>(raw: unknown, allowed: readonly E[], fallback: E): E {
    return typeof raw === 'string' && (allowed as readonly string[]).includes(raw) ? (raw as E) : fallback
  },

  /** An array, each element mapped + filtered through `item` (drop nulls), capped at `max` entries. */
  array<U>(raw: unknown, item: (el: unknown) => U | null, max = 100): U[] {
    if (!Array.isArray(raw)) return []
    const out: U[] = []
    for (const el of raw) {
      const mapped = item(el)
      if (mapped !== null) out.push(mapped)
      if (out.length >= max) break
    }
    return out
  },
}
