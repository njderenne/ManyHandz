import { APP_CONFIG } from '@/lib/config/app'

/**
 * FeatureGate — render children only when an opt-in feature flag is enabled in APP_CONFIG.features.
 * The single place feature-flagged UI is gated, so flipping a flag lights up (or hides) a surface.
 */
export function FeatureGate({
  feature,
  children,
  fallback = null,
}: {
  feature: keyof typeof APP_CONFIG.features
  children: React.ReactNode
  fallback?: React.ReactNode
}) {
  return <>{APP_CONFIG.features[feature] ? children : fallback}</>
}
