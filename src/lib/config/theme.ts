import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { colorScheme, useColorScheme } from 'nativewind'

/**
 * Theming — light + dark, defaulting to dark, with a "system" option that follows the device.
 *
 * Semantic colors live as CSS variables (global.css) so class names theme automatically. This
 * file owns (1) the persisted user preference and (2) the imperative palette for things that need
 * a raw color value (icon `color` props, placeholders) rather than a class.
 */
export type ThemeMode = 'light' | 'dark' | 'system'

type ThemeState = {
  mode: ThemeMode
  setMode: (mode: ThemeMode) => void
}

/** Persisted theme preference. Default dark; 'system' follows the device. */
export const useThemeMode = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'dark',
      setMode: (mode) => {
        colorScheme.set(mode)
        set({ mode })
      },
    }),
    {
      name: 'theme-mode',
      storage: createJSONStorage(() => AsyncStorage),
      onRehydrateStorage: () => (state) => {
        colorScheme.set(state?.mode ?? 'dark')
      },
    },
  ),
)

/** The active resolved scheme ('system' resolved to light/dark by the device). */
export function useActiveScheme(): 'light' | 'dark' {
  const { colorScheme: cs } = useColorScheme()
  return cs === 'light' ? 'light' : 'dark'
}

/**
 * Imperative palette — raw hex per scheme, mirroring the tokens. Use via `useColors()` for icon
 * `color` props, placeholders, and anything that can't be a className. Keep in sync with global.css.
 */
export const palette = {
  dark: {
    foreground: '#f7f9fc',
    mutedForeground: '#9aa5b8',
    border: '#232b3d',
    card: '#111726',
    background: '#0a0e1a',
    accent: '#262f45',
    primary: '#6366f1',
    brand: '#828df8',
    success: '#22c55e',
    warning: '#f59e0b',
    destructive: '#ef4444',
    placeholder: '#6b7689',
    skeleton: '#262f45',
    onPrimary: '#ffffff',
    /** Elevation shadow (FAB, raised surfaces). Black in both schemes by design — see theme-guard.test.ts. */
    shadow: '#000000',
    /** Decorative brand gradient stops (hero surfaces, banners). */
    brandGradient: ['#6366f1', '#a855f7'] as [string, string],
  },
  light: {
    foreground: '#0f172a',
    mutedForeground: '#58687f', // = global.css --muted-foreground 88 104 127 (contrast-bumped)
    border: '#e2e8f0',
    card: '#ffffff',
    background: '#f8fafc',
    accent: '#e2e8f0',
    primary: '#6366f1',
    brand: '#6366f1',
    success: '#16a34a',
    warning: '#d97706',
    destructive: '#ef4444',
    placeholder: '#94a3b8',
    skeleton: '#e2e8f0',
    onPrimary: '#ffffff',
    /** Elevation shadow (FAB, raised surfaces). Black in both schemes by design — see theme-guard.test.ts. */
    shadow: '#000000',
    /** Decorative brand gradient stops (hero surfaces, banners). */
    brandGradient: ['#6366f1', '#a855f7'] as [string, string],
  },
}

export type Palette = (typeof palette)['dark']

/** The active scheme's raw color palette. Re-renders on theme change. */
export function useColors(): Palette {
  return palette[useActiveScheme()]
}
