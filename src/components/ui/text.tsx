import { Text as RNText, StyleSheet } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'
import { usePrefs, LARGE_TEXT_SCALE } from '@/lib/prefs'

/**
 * Text — the canonical typographic primitive and the single source of typography. Each variant
 * carries its size + the matching font family (RN needs a distinct family per weight, so weight
 * comes from the family, not a `font-*` class). Use `<Text variant=…>` everywhere; swap the font
 * app-wide in lib/config/fonts.ts.
 *
 * ACCESSIBILITY (load-bearing): when the `largeText` preference is on (Settings → Accessibility),
 * EVERY variant scales up by LARGE_TEXT_SCALE here — the single choke-point that reaches the whole
 * app. Because RN can't read a px size back out of a Tailwind class, each variant's base size is
 * mirrored in VARIANT_PX below (kept in sync with the size classes in `textVariants`); when the
 * pref is on we emit an explicit, scaled fontSize/lineHeight via `style` so the class size is
 * overridden. This is in addition to (not instead of) the OS Dynamic Type support below.
 */
const textVariants = cva('text-foreground', {
  variants: {
    variant: {
      h1: 'text-4xl tracking-tight',
      h2: 'text-2xl tracking-tight',
      h3: 'text-xl',
      body: 'text-base',
      label: 'text-sm',
      muted: 'text-sm text-muted-foreground',
      caption: 'text-xs text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'body' },
})

const FONT_FAMILY: Record<NonNullable<VariantProps<typeof textVariants>['variant']>, string> = {
  h1: fonts.bold,
  h2: fonts.semibold,
  h3: fonts.semibold,
  body: fonts.regular,
  label: fonts.medium,
  muted: fonts.regular,
  caption: fonts.regular,
}

/**
 * Base px per variant — MUST mirror the size classes in `textVariants` (Tailwind's default scale:
 * text-4xl=36, text-2xl=24, text-xl=20, text-base=16, text-sm=14, text-xs=12). Only consulted when
 * `largeText` is on, to compute an explicit scaled size; the className still drives normal rendering.
 */
const VARIANT_PX: Record<NonNullable<VariantProps<typeof textVariants>['variant']>, number> = {
  h1: 36,
  h2: 24,
  h3: 20,
  body: 16,
  label: 14,
  muted: 14,
  caption: 12,
}

export type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>

export function Text({ className, variant, style, ...props }: TextProps) {
  // Reactive: toggling Accessibility → Large text re-renders every Text in the tree.
  const largeText = usePrefs((s) => s.largeText)
  const v = variant ?? 'body'
  // Base px: an inline style.fontSize wins over the variant's class size, so derive from it when
  // present. Applied AFTER spreading `style` so an inline fontSize no longer defeats Large Text.
  const flatStyle = StyleSheet.flatten(style) as { fontSize?: number } | undefined
  const basePx = flatStyle?.fontSize ?? VARIANT_PX[v]
  const scaledStyle = largeText
    ? { fontSize: basePx * LARGE_TEXT_SCALE, lineHeight: basePx * LARGE_TEXT_SCALE * 1.3 }
    : null
  return (
    <RNText
      className={cn(textVariants({ variant }), className)}
      style={[{ fontFamily: FONT_FAMILY[v] }, style, scaledStyle]}
      // Cap Dynamic Type scaling: honors user font-size prefs up to 130% without exploding
      // fixed-height chrome (TopBar/BottomNav/Button). Callers can override for body copy.
      maxFontSizeMultiplier={1.3}
      {...props}
    />
  )
}
