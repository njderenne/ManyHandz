import { Platform } from 'react-native'
import { Suspense, lazy, type ComponentType } from 'react'
import { ChartEmpty } from './empty'
import { loadSkiaWeb } from './skia-web-loader'

/**
 * Lazy-after-load wrapper for the victory-native + Skia charts (projectgains donor).
 *
 * Skia/CanvasKit availability has two very different stories:
 *
 *   NATIVE — Skia is a native module baked into the binary → ready immediately, no wasm to load.
 *
 *   WEB — Skia runs on CanvasKit (~2MB wasm). victory-native and @shopify/react-native-skia bind
 *   their CanvasKit reference AT MODULE-IMPORT time, so if a screen statically imports a chart at
 *   app start (before CanvasKit is downloaded) every Skia call explodes
 *   ("Cannot read properties of undefined (reading 'XYWHRect')").
 *
 * The fix: never let the heavy Skia impl into the app-start bundle graph. The wrapper that ships
 * to screens imports nothing from victory-native/Skia; it only DYNAMICALLY imports the impl, and on
 * web it first awaits LoadSkiaWeb() so CanvasKit is in place before that module ever evaluates. Until
 * the chart resolves, screens see the safe Skia-free <ChartEmpty/> placeholder.
 *
 * TEMPLATE NAMING NOTE (differs from the projectgains donor): here the plain-named chart files
 * (./line-chart etc.) are the EAGER Skia impls — they predate the harvest and their exports are
 * frozen (the gated gallery imports them). The `-skia`-suffixed files are therefore the LAZY,
 * import-anywhere wrappers built with this loader. New screens should import the `-skia` variants.
 */
let skiaWeb: Promise<unknown> | null = null

/**
 * Resolve once Skia is usable: immediately on native, after CanvasKit downloads on web. Exported
 * so screens that gate a whole Skia subtree themselves (app/charts.tsx's showcase) share the one
 * in-flight promise instead of duplicating the LoadSkiaWeb ceremony.
 *
 * The actual CanvasKit import lives in the platform-split ./skia-web-loader (.web.ts vs .ts):
 * Metro resolves dynamic import() statically per platform bundle, so a direct import of
 * `@shopify/react-native-skia/lib/module/web` here — even behind this Platform.OS guard — drags
 * canvaskit-wasm (which imports node `fs`) into ios/android bundles and breaks the native build.
 */
export function ensureSkiaWeb() {
  if (Platform.OS !== 'web') return Promise.resolve()
  if (!skiaWeb) skiaWeb = loadSkiaWeb()
  return skiaWeb
}

/**
 * Build a thin chart wrapper that lazy-loads its Skia impl (loading CanvasKit first on web). The
 * `load` thunk must `import()` the impl dynamically — passing it statically would defeat the purpose.
 */
export function lazySkiaChart<P extends { height?: number }>(
  load: () => Promise<{ default: ComponentType<P> }>,
): ComponentType<P> {
  const Lazy = lazy(async () => {
    await ensureSkiaWeb()
    return load()
  })
  return function SkiaChart(props: P) {
    return (
      <Suspense fallback={<ChartEmpty height={props.height ?? 220} />}>
        <Lazy {...props} />
      </Suspense>
    )
  }
}
