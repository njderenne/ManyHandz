/**
 * NATIVE half of the platform-split CanvasKit loader (Metro picks `.web.ts` on web, this file on
 * ios/android). Skia is a native module baked into the binary — there is nothing to load.
 *
 * WHY THE SPLIT EXISTS (do not fold this back into lazy-skia.tsx): Metro resolves EVERY `import()`
 * statically when it builds a platform bundle — a `Platform.OS === 'web'` guard hides the code at
 * runtime but not from the resolver. `@shopify/react-native-skia/lib/module/web` pulls
 * `canvaskit-wasm`, whose entry does `import "fs"` — unresolvable on ios/android, so a native
 * production build dies in the Bundle JavaScript phase (EAS builds cf22b88e/f4f60a02, 2026-07-16).
 * Platform extensions are the one split Metro applies at RESOLUTION time, which keeps the
 * CanvasKit graph out of native bundles entirely.
 */
export function loadSkiaWeb(): Promise<unknown> {
  return Promise.resolve()
}
