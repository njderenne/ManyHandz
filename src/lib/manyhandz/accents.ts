/**
 * Accent palette — the per-member 12-color picker + the category colors. These are FIXED identity
 * hexes that intentionally do NOT flip with the light/dark theme (like an avatar ring color), so
 * this file is exempted from the theme-guard. Keys are what's stored on member.favoriteColor and
 * chore_category.color; the UI resolves them to a hex via accentHex().
 */
export const ACCENT_PALETTE = {
  coral: '#FF6B4A', // the brand default
  indigo: '#6366F1',
  violet: '#8B5CF6',
  rose: '#F43F5E',
  pink: '#EC4899',
  amber: '#F59E0B',
  emerald: '#10B981',
  cyan: '#06B6D4',
  blue: '#3B82F6',
  orange: '#F97316',
  lime: '#84CC16',
  fuchsia: '#D946EF',
  sky: '#0EA5E9',
  slate: '#64748B', // neutral / "General" category / fallback
} as const

export type AccentKey = keyof typeof ACCENT_PALETTE
export const ACCENT_KEYS = Object.keys(ACCENT_PALETTE) as AccentKey[]
/** The 12 member-pickable accents (everything except the neutral slate). */
export const MEMBER_ACCENT_KEYS = ACCENT_KEYS.filter((k) => k !== 'slate')

/** Resolve an accent/category color key to its hex; unknown/empty falls back to the coral brand. */
export function accentHex(key: string | null | undefined): string {
  return key && key in ACCENT_PALETTE ? ACCENT_PALETTE[key as AccentKey] : ACCENT_PALETTE.coral
}
