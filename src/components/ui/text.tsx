import { Text as RNText } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'

/**
 * Text — the canonical typographic primitive and the single source of typography. Each variant
 * carries its size + the matching font family (RN needs a distinct family per weight, so weight
 * comes from the family, not a `font-*` class). Use `<Text variant=…>` everywhere; swap the font
 * app-wide in lib/config/fonts.ts.
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

export type TextProps = React.ComponentProps<typeof RNText> & VariantProps<typeof textVariants>

export function Text({ className, variant, style, ...props }: TextProps) {
  return (
    <RNText
      className={cn(textVariants({ variant }), className)}
      style={[{ fontFamily: FONT_FAMILY[variant ?? 'body'] }, style]}
      // Cap Dynamic Type scaling: honors user font-size prefs up to 130% without exploding
      // fixed-height chrome (TopBar/BottomNav/Button). Callers can override for body copy.
      maxFontSizeMultiplier={1.3}
      {...props}
    />
  )
}
