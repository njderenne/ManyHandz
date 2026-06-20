/**
 * i18n — a minimal, dependency-light translation layer (no i18next, no async loading).
 *
 * WHY this exists: store listings reach non-English markets long before a full localization
 * pass does, and retrofitting hardcoded copy is the expensive part. So the CONVENTION is:
 * **all NEW user-facing copy goes through `t()`; existing copy migrates opportunistically**
 * (i.e. when you touch a screen, move its strings into the catalog — don't do a big-bang
 * sweep). Shipping English-only is fine; shipping un-catalogued strings is the debt.
 *
 * How it works:
 * - `src/lib/i18n/en.ts` is the typed base catalog (flat, namespaced keys → English strings).
 * - `t(key, params?)` resolves the device language via `expo-localization` (`getLocales()`),
 *   looks the key up in that language's catalog, and falls back to English. `{name}`-style
 *   placeholders are interpolated from `params`.
 * - Everything is synchronous and tree-shakeable: catalogs are plain `as const` objects,
 *   there is no provider/context to mount, and `t()` is safe at module scope (e.g. zod
 *   schema messages) and during static web export.
 * - `useLocale()` is the reactive variant for the rare component that must re-render when
 *   the OS language changes (e.g. a settings screen showing the current language).
 *
 * Adding a locale: create `src/lib/i18n/<lang>.ts` exporting a (partial) catalog with the
 * same keys, then register it in `catalogs` below. Missing keys fall back to English.
 */
import { getLocales, useLocales } from 'expo-localization'
import { en } from './en'

/** Every valid catalog key — compile-time checked, so typos fail `tsc`, not users. */
export type TranslationKey = keyof typeof en

/** A locale catalog: partial is allowed; missing keys fall back to the English base. */
type Catalog = Partial<Record<TranslationKey, string>>

/** All registered catalogs, keyed by ISO 639 language code. Add new locales here. */
const catalogs: Record<string, Catalog> = { en }

/**
 * The device's preferred ISO 639 language code (e.g. `'en'`, `'es'`), defaulting to `'en'`.
 * Wrapped in try/catch because `getLocales()` touches platform APIs that don't exist in
 * Node during static web export or unit tests — English is the safe answer there.
 */
function getDeviceLanguage(): string {
  try {
    return getLocales()[0]?.languageCode ?? 'en'
  } catch {
    return 'en'
  }
}

/** Fill `{name}`-style placeholders from `params`; unknown placeholders are left intact. */
function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/**
 * Translate a catalog key for the current device language, with English fallback.
 *
 * @example
 * t('common.save') // 'Save'
 * t('auth.signInTo', { name: APP_CONFIG.name }) // 'Sign in to Acme'
 */
export function t(key: TranslationKey, params?: Record<string, string | number>): string {
  const template = catalogs[getDeviceLanguage()]?.[key] ?? en[key]
  return interpolate(template, params)
}

/**
 * Reactive hook for the current device language code (`'en'` fallback). Re-renders when the
 * OS locale changes. Most screens don't need this — `t()` already reads the device language
 * per call; reach for this only when a component displays or branches on the locale itself.
 */
export function useLocale(): string {
  return useLocales()[0]?.languageCode ?? 'en'
}
