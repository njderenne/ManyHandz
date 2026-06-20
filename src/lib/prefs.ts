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
type PrefsState = {
  hapticsEnabled: boolean
  soundsEnabled: boolean
  /** Display unit system for measurements (height/weight/distance). Display-only — see units.ts. */
  unitSystem: UnitSystem
  setHapticsEnabled: (enabled: boolean) => void
  setSoundsEnabled: (enabled: boolean) => void
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
      unitSystem: defaultUnitSystem,
      setHapticsEnabled: (hapticsEnabled) => set({ hapticsEnabled }),
      setSoundsEnabled: (soundsEnabled) => set({ soundsEnabled }),
      setUnitSystem: (unitSystem) => set({ unitSystem }),
    }),
    {
      name: 'user-prefs',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
)
