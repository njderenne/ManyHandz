import appJson from '../app.json'

/**
 * The deployed app version — read straight from app.json (expo.version) at bundle time, so the
 * Worker and the store builds share one source of truth and can never drift. Surfaced via
 * GET /api/health (ops visibility: which version is live?) and GET /api/meta (the client
 * force-update gate compares this + minAppVersion against its own runtime version).
 *
 * Requires `resolveJsonModule` in worker/tsconfig.json; wrangler's esbuild bundles JSON natively.
 */
export const VERSION: string = appJson.expo.version
