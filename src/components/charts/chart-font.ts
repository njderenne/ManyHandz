import { useFont } from '@shopify/react-native-skia'

/**
 * Skia font for chart axis labels — the app's Inter typeface. Returns null until loaded (charts
 * render without axis text for that first frame, then snap in).
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const InterRegular = require('@expo-google-fonts/inter/400Regular/Inter_400Regular.ttf')

export function useChartFont(size = 12) {
  return useFont(InterRegular, size)
}
