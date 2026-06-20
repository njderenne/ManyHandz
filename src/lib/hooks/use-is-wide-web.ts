import { Platform, useWindowDimensions } from 'react-native'

/**
 * Viewport width (px) at/above which the WEB build switches from the bottom tab bar to the desktop
 * top nav. 1024 = Tailwind's `lg` and the template's `wide` content lane — a coherent "this is a
 * desktop, not a phone-width window" threshold.
 */
export const WIDE_WEB_MIN_WIDTH = 1024

/**
 * True only on the WEB build at a desktop-class width (>= 1024px). Native is ALWAYS false, so any
 * `useIsWideWeb()` branch leaves iOS/Android byte-for-byte unchanged. Drives the nav swap (bottom
 * tab bar → top nav) and the FAB's bottom offset. Updates live on browser resize via
 * `useWindowDimensions` — which on web reads the real window width on first paint (the web build is
 * a client-rendered SPA, output:"single"), so there is no static-render/hydration nav flash.
 */
export function useIsWideWeb(): boolean {
  const { width } = useWindowDimensions()
  return Platform.OS === 'web' && width >= WIDE_WEB_MIN_WIDTH
}
