import { View } from 'react-native'
import { Info, CircleCheck, TriangleAlert, CircleX } from 'lucide-react-native'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from './text'

/**
 * Alert — an inline banner for info/success/warning/error messages.
 */
const alertVariants = cva('flex-row gap-3 rounded-lg border p-3', {
  variants: {
    variant: {
      info: 'border-border bg-card',
      success: 'border-success/40 bg-success/10',
      warning: 'border-warning/40 bg-warning/10',
      error: 'border-destructive/40 bg-destructive/10',
    },
  },
  defaultVariants: { variant: 'info' },
})

// Icon per variant; the color is a palette token so it flips with the theme (resolved in render).
const ICONS = {
  info: { Icon: Info, token: 'brand' },
  success: { Icon: CircleCheck, token: 'success' },
  warning: { Icon: TriangleAlert, token: 'warning' },
  error: { Icon: CircleX, token: 'destructive' },
} as const

export type AlertProps = VariantProps<typeof alertVariants> & {
  title: string
  description?: string
  className?: string
}

export function Alert({ variant = 'info', title, description, className }: AlertProps) {
  const colors = useColors()
  const { Icon, token } = ICONS[variant ?? 'info']
  return (
    <View className={cn(alertVariants({ variant }), className)}>
      <Icon color={colors[token]} size={20} />
      <View className="flex-1 gap-0.5">
        <Text variant="label">{title}</Text>
        {description ? <Text variant="muted">{description}</Text> : null}
      </View>
    </View>
  )
}
