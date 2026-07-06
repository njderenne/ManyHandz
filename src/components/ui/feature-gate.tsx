import { APP_CONFIG } from '@/lib/config/app'
import { kindFeature } from '@/lib/config/roles'

/**
 * FeatureGate — render children only when an opt-in feature flag is enabled.
 * The single place feature-flagged UI is gated, so flipping a flag lights up (or hides) a surface.
 *
 * With the optional `kind` prop it composes the SPINE §7 lookup order (1+2): a kind's override
 * (KIND_CONFIGS[kind].features) wins over the app-wide APP_CONFIG.features flag — ManyHandz's
 * "roommate mode has no gamification" pattern. Pass `useActiveContext().active?.kind`; when
 * `kind` is undefined (loading, signed-out, or a kind-agnostic surface) the app-wide flag alone
 * decides — exactly today's behavior. The server-side twin is requireKindFeature (worker
 * middleware); this component only HIDES controls, it never authorizes.
 */
export function FeatureGate({
  feature,
  kind,
  children,
  fallback = null,
}: {
  feature: keyof typeof APP_CONFIG.features
  /** Optional org kind — composes the per-kind feature override over the app-wide flag. */
  kind?: string
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  const enabled = kind !== undefined ? kindFeature(kind, feature) : APP_CONFIG.features[feature]
  return <>{enabled ? children : fallback}</>
}
