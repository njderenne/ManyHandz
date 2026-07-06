import Animated from 'react-native-reanimated'
import { cssInterop } from 'nativewind'

/**
 * NativeWind ↔ Reanimated interop.
 *
 * NativeWind v4 does not apply `className` to react-native-reanimated's Animated components out of
 * the box. Our animated modals (Sheet, Dialog, ActionSheet) put their background/border/layout on
 * `<Animated.View className="… bg-card …">`, so without this those classes are DROPPED and the
 * panels + backdrops render fully transparent — the dreaded see-through sheet. Registering the
 * interop once here remaps className → style on the Animated components app-wide (web + native).
 *
 * Imported for its side effect at the very top of app/_layout.tsx (right after global.css), before
 * any Animated component mounts.
 */
cssInterop(Animated.View, { className: 'style' })
cssInterop(Animated.ScrollView, { className: 'style' })
