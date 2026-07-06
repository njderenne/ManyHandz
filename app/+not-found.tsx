import { Stack, router } from 'expo-router'
import { Compass } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'

/**
 * 404 — expo-router renders this for any unmatched route (a stale/typo'd deep link). Without it, a
 * bad link falls to expo-router's unbranded developer "Unmatched Route" debug screen, which would
 * ship to production and dead-end App Store / Play reviewers probing deep links. Branded EmptyState
 * + a way home instead.
 */
export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Not found' }} />
      <PageWrapper className="flex-1 justify-center">
        <EmptyState
          icon={Compass}
          title="Page not found"
          description="That link doesn't go anywhere — it may be old or mistyped."
          action={<Button label="Go home" onPress={() => router.replace('/')} />}
        />
      </PageWrapper>
    </>
  )
}
