/**
 * WEB half of the platform-split CanvasKit loader (see skia-web-loader.ts for why the split must
 * exist). Dynamically imports the Skia web binding and downloads CanvasKit (~2MB wasm) from the
 * CDN; victory-native / @shopify/react-native-skia bind their CanvasKit reference at module-import
 * time, so this must complete before any Skia chart impl module evaluates (lazy-skia.tsx owns the
 * once-only in-flight promise).
 */
const CANVASKIT_VERSION = '0.41.0' // keep in lockstep with node_modules/canvaskit-wasm

export function loadSkiaWeb(): Promise<unknown> {
  return import('@shopify/react-native-skia/lib/module/web').then(({ LoadSkiaWeb }) =>
    LoadSkiaWeb({
      locateFile: (f) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${CANVASKIT_VERSION}/bin/full/${f}`,
    }),
  )
}
