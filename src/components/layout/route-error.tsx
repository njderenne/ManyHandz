import { View } from 'react-native'
import { router, type ErrorBoundaryProps } from 'expo-router'
import { TriangleAlert } from 'lucide-react-native'
import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'

/**
 * Route-level error screen — re-exported from app/_layout.tsx as `ErrorBoundary` so expo-router
 * renders it when any screen throws, instead of a white screen. Navigation survives, so both
 * retry and "Go home" work. (The class ErrorBoundary in ui/ still guards above the navigator.)
 */
export function RouteError({ error, retry }: ErrorBoundaryProps) {
  return (
    <View className="flex-1 items-center justify-center bg-background p-6">
      <EmptyState
        icon={TriangleAlert}
        title="This screen hit a problem"
        description={error.message}
        action={
          <View className="flex-row gap-3">
            <Button label="Try again" onPress={() => retry()} />
            <Button label="Go home" variant="outline" onPress={() => router.replace('/')} />
          </View>
        }
      />
    </View>
  )
}
