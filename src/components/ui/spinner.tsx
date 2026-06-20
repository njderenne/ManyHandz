import { ActivityIndicator } from 'react-native'
import { useColors } from '@/lib/config/theme'

/**
 * Spinner — a brand-tinted activity indicator for inline/loading states.
 */
export type SpinnerProps = {
  size?: 'small' | 'large'
  color?: string
}

export function Spinner({ size = 'small', color }: SpinnerProps) {
  const colors = useColors()
  return <ActivityIndicator size={size} color={color ?? colors.brand} />
}
