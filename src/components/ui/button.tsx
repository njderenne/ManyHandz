import { memo } from 'react'
import { ActivityIndicator, type PressableProps } from 'react-native'
import type { LucideIcon } from 'lucide-react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { PressableScale } from './pressable-scale'
import { Text } from './text'

/**
 * Button — the canonical pressable.
 *
 * Pressable (not Touchable) for the press states NativeWind's `active:` variant hooks into.
 * The container and its label are themed by paired CVA tables so a variant restyles both at
 * once. Pass `label` for the common text case, or `children` for custom content.
 *
 * Press feedback: buttons deliberately combine `active:scale-95` with an opacity/background
 * change — the strongest affordance in the kit, reserved for primary tappables. Flat tappables
 * (rows, tabs, segments) use opacity/background only, so buttons read as "more pressable".
 */
const buttonVariants = cva('flex-row items-center justify-center gap-2 rounded-md active:scale-95', {
  variants: {
    variant: {
      default: 'bg-primary active:opacity-90',
      secondary: 'bg-secondary active:opacity-90',
      destructive: 'bg-destructive active:opacity-90',
      outline: 'border border-border bg-transparent active:bg-accent',
      ghost: 'bg-transparent active:bg-accent',
    },
    size: {
      sm: 'h-9 px-3',
      default: 'h-11 px-4',
      lg: 'h-12 px-6',
    },
  },
  defaultVariants: { variant: 'default', size: 'default' },
})

const buttonTextVariants = cva('', {
  variants: {
    variant: {
      default: 'text-primary-foreground',
      secondary: 'text-secondary-foreground',
      destructive: 'text-destructive-foreground',
      outline: 'text-foreground',
      ghost: 'text-foreground',
    },
  },
  defaultVariants: { variant: 'default' },
})

/** Spinner/icon tint per variant — solid fills get onPrimary, transparent variants the foreground. */
function tintFor(
  variant: VariantProps<typeof buttonVariants>['variant'],
  colors: { foreground: string; onPrimary: string },
) {
  return variant === 'secondary' || variant === 'outline' || variant === 'ghost'
    ? colors.foreground
    : colors.onPrimary
}

export type ButtonProps = Omit<PressableProps, 'children'> &
  VariantProps<typeof buttonVariants> & {
    label?: string
    loading?: boolean
    icon?: LucideIcon
    children?: React.ReactNode
  }

function ButtonImpl({
  className,
  variant,
  size,
  label,
  loading = false,
  icon: Icon,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading
  const tint = tintFor(variant, useColors())
  return (
    <PressableScale
      className={cn(buttonVariants({ variant, size }), isDisabled && 'opacity-50', className)}
      disabled={isDisabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: isDisabled, busy: loading }}
      {...props}
    >
      {loading ? (
        <ActivityIndicator size="small" color={tint} />
      ) : Icon ? (
        <Icon color={tint} size={16} />
      ) : null}
      {label ? (
        <Text variant="label" className={cn(buttonTextVariants({ variant }))}>
          {label}
        </Text>
      ) : (
        children
      )}
    </PressableScale>
  )
}

/** Memoized — parent re-renders with stable props skip the whole Button subtree. */
export const Button = memo(ButtonImpl)
