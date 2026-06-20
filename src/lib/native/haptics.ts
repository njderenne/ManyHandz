import { Platform } from 'react-native'
import * as Haptics from 'expo-haptics'
import { usePrefs } from '@/lib/prefs'

/**
 * Haptics — tactile feedback for taps, successes, and errors. No-ops on web, respects the user's
 * Settings toggle, and swallows any native rejection so a haptic can never crash a flow.
 */
function run(fn: () => Promise<void>) {
  if (Platform.OS !== 'web' && usePrefs.getState().hapticsEnabled) fn().catch(() => {})
}

export const haptics = {
  light: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  medium: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  heavy: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
  selection: () => run(() => Haptics.selectionAsync()),
}
