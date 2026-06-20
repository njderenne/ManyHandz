import { Suspense, lazy } from 'react'
import { Platform, View } from 'react-native'
import { ChartColumnBig } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorBoundary } from '@/components/ui/error-boundary'

/**
 * Charts gallery (pushed route, not a tab). The victory-native suite renders on Skia, which has
 * two very different availability stories:
 *
 *   NATIVE — Skia is a native module baked into the binary; a build that predates it shows the
 *   graceful "needs the latest build" fallback (the lazy import throws, the boundary catches).
 *
 *   WEB — Skia runs on CanvasKit (a ~2MB wasm). It must be LOADED before the first Skia
 *   component renders or every Skia call explodes ('XYWHRect of undefined'). We load it lazily
 *   HERE — not at app start — so only chart screens pay the wasm cost. The binary is pinned to
 *   the installed canvaskit-wasm version and served from the CDN (no bundler wasm plumbing).
 */
const CANVASKIT_VERSION = '0.41.0' // keep in lockstep with node_modules/canvaskit-wasm

const ChartsShowcase =
  Platform.OS === 'web'
    ? lazy(async () => {
        const { LoadSkiaWeb } = await import('@shopify/react-native-skia/lib/module/web')
        await LoadSkiaWeb({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/canvaskit-wasm@${CANVASKIT_VERSION}/bin/full/${file}`,
        })
        return import('@/components/gallery/charts-showcase')
      })
    : lazy(() => import('@/components/gallery/charts-showcase'))

function Unavailable() {
  return (
    <EmptyState
      icon={ChartColumnBig}
      title={Platform.OS === 'web' ? "Charts couldn't load" : 'Charts need the latest dev build'}
      description={
        Platform.OS === 'web'
          ? 'The chart engine (CanvasKit) failed to download — check your connection and reload the page.'
          : 'The chart engine (Skia) was just added. Install the newest dev build to view the interactive charts.'
      }
    />
  )
}

export default function ChartsScreen() {
  return (
    <PageWrapper className="gap-6 pb-24">
      <View className="gap-1">
        <Text variant="h1">Charts</Text>
        <Text variant="muted">Interactive charts on victory-native + Skia. Drag across any line or area to read values.</Text>
      </View>
      <ErrorBoundary fallback={<Unavailable />}>
        <Suspense
          fallback={
            <View className="items-center py-12">
              <Spinner />
            </View>
          }
        >
          <ChartsShowcase />
        </Suspense>
      </ErrorBoundary>
    </PageWrapper>
  )
}
