import { View, type ViewProps } from 'react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { Text } from './text'
import { fonts } from '@/lib/config/fonts'

/**
 * Badge — a small status/label pill. Use `label` for text, or pass children.
 */
const badgeVariants = cva('self-start rounded-full px-2.5 py-0.5', {
  variants: {
    variant: {
      default: 'bg-primary',
      secondary: 'bg-secondary',
      success: 'bg-success',
      warning: 'bg-warning',
      destructive: 'bg-destructive',
      outline: 'border border-border bg-transparent',
    },
  },
  defaultVariants: { variant: 'default' },
})

// Weight comes from the Text variant's font family (caption→regular won't do for a pill: pass
// the medium family below), never from font-* classes — RN picks weight by family, not CSS.
const badgeTextVariants = cva('text-xs', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      // Dark text on the green/amber fills: white fails WCAG on both schemes' values
      // (2.2:1 on amber-500); near-black clears 4.5:1 on all four fill colors.
      success: 'text-black/90',
      warning: 'text-black/90',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

export type BadgeProps = ViewProps &
  VariantProps<typeof badgeVariants> & {
    label?: string
  }

export function Badge({ className, variant, label, children, ...props }: BadgeProps) {
  return (
    <View className={cn(badgeVariants({ variant }), className)} {...props}>
      <Text className={cn(badgeTextVariants({ variant }))} style={{ fontFamily: fonts.medium }}>
        {label ?? children}
      </Text>
    </View>
  )
}
