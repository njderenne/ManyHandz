import { Text } from '@/components/ui/text'

/**
 * Centered, muted caption under a chart — the first-class home for the date span (or any axis
 * note) a time-series covers. Rendered by line/area/bar when `xAxisLabel` is set; returns null
 * otherwise so charts without it stay byte-identical. Uses the shared muted Text style.
 */
export function XAxisCaption({ label }: { label?: string }) {
  if (!label) return null
  return (
    <Text variant="muted" className="mt-1 text-center">
      {label}
    </Text>
  )
}
