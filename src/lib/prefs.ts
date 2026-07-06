import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { APP_CONFIG } from '@/lib/config/app'
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '@/lib/config/units'

/**
 * User preferences — persisted, user-facing toggles (Settings screen). Mirrors the theme store's
 * pattern (lib/config/theme.ts). Non-React call sites (haptics, sounds) read via
 * `usePrefs.getState()` — safe outside components, and a momentary cold-start default of `true`
 * before rehydration is harmless for feedback toggles.
 */
/**
 * Large Text accessibility scale — the font-size multiplier applied to EVERY <Text> when the
 * `largeText` pref is on (see src/components/ui/text.tsx). 1.3 matches the maxFontSizeMultiplier cap
 * so a manual toggle and OS Dynamic Type top out at the same 130% (chrome stays intact).
 */
export const LARGE_TEXT_SCALE = 1.3

type PrefsState = {
  hapticsEnabled: boolean
  soundsEnabled: boolean
  /** Accessibility → Large text. When on, every <Text> scales by LARGE_TEXT_SCALE (text.tsx). */
  largeText: boolean
  /**
   * Accessibility → Color-blind-friendly charts. When on, every chart's categorical series ramp
   * swaps to the Okabe-Ito CVD-safe set — chartPalette/useChartPalette read this pref, so the flip
   * reaches every chart from one place (see src/components/charts/palette.ts; RxMndr donor).
   */
  colorBlindSafe: boolean
  /** Display unit system for measurements (height/weight/distance). Display-only — see units.ts. */
  unitSystem: UnitSystem
  setHapticsEnabled: (enabled: boolean) => void
  setSoundsEnabled: (enabled: boolean) => void
  setLargeText: (enabled: boolean) => void
  setColorBlindSafe: (enabled: boolean) => void
  setUnitSystem: (system: UnitSystem) => void
}

/** Per-app default unit system (APP_CONFIG.units.default), falling back to the fleet default. */
const defaultUnitSystem: UnitSystem =
  (APP_CONFIG as { units?: { default?: UnitSystem } }).units?.default ?? DEFAULT_UNIT_SYSTEM

export const usePrefs = create<PrefsState>()(
  persist(
    (set) => ({
      hapticsEnabled: true,
      soundsEnabled: true,
      largeText: false,
      colorBlindSafe: false,
      unitSystem: defaultUnitSystem,
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setSoundsEnabled: (soundsEnabled) => set({ soundsEnabled }),
      setLargeText: (largeText) => set({ largeText }),
      setColorBlindSafe: (colorBlindSafe) => set({ colorBlindSafe }),
      setUnitSystem: (unitSystem) => set({ unitSystem }),
    }),
    {
      name: 'user-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
