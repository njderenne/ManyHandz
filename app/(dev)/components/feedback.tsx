import { useState } from 'react'
import { View } from 'react-native'
import { Inbox } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Skeleton, SkeletonText, SkeletonCircle, SkeletonCard } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/ui/empty-state'
import { Alert } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { Dialog } from '@/components/ui/dialog'
import { ActionSheet } from '@/components/ui/action-sheet'
import { SheetModal } from '@/components/ui/sheet'
import { ListItem } from '@/components/ui/list'
import { Card, CardContent } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { Section } from '@/components/gallery/kit'

/** Feedback tab — loading, empty, and notification surfaces, plus overlays (dialog, sheet, toast). */

/** Demo child that throws on demand so the ErrorBoundary section has something to catch. */
function ErrorTrigger({ blow }: { blow: boolean }) {
  if (blow) throw new Error('Boom — caught by the ErrorBoundary')
  return <Text variant="muted">No errors. Tap "Trigger crash".</Text>
}

export default function FeedbackScreen() {
  const { toast } = useToast()
  const [dialog, setDialog] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [bottomSheet, setBottomSheet] = useState(false)
  const [qState, setQState] = useState<'loading' | 'error' | 'empty' | 'data'>('data')
  const [blow, setBlow] = useState(false)
  const [crashKey, setCrashKey] = useState(0)
  const fakeQuery = {
    isLoading: qState === 'loading',
    isError: qState === 'error',
    error: new Error('Network request failed'),
    refetch: () => setQState('data'),
  }

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Feedback</Text>

      <Section title="Spinners">
        <View className="flex-row items-center gap-6">
          <Spinner size="small" />
          <Spinner size="large" />
        </View>
      </Section>

      <Section title="Skeleton" description="Shimmering loading placeholders">
        <Card>
          <CardContent className="gap-3">
            <View className="flex-row items-center gap-3">
              <Skeleton className="size-12 rounded-full" />
              <View className="flex-1 gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-20" />
              </View>
            </View>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
          </CardContent>
        </Card>
      </Section>

      <Section title="Skeleton variants" description="SkeletonText / SkeletonCircle / SkeletonCard">
        <Card>
          <CardContent className="gap-4">
            <View className="flex-row items-center gap-3">
              <SkeletonCircle size={48} />
              <SkeletonCircle size={36} />
              <SkeletonCircle size={28} />
            </View>
            <SkeletonText lines={3} />
          </CardContent>
        </Card>
        <SkeletonCard />
      </Section>

      <Section title="Alerts">
        <Alert variant="info" title="Heads up" description="This is an informational message." />
        <Alert variant="success" title="Saved" description="Your changes were saved." />
        <Alert variant="warning" title="Trial ending" description="3 days left on your trial." />
        <Alert variant="error" title="Payment failed" description="Update your card to continue." />
      </Section>

      <Section title="Toast" description="Transient, auto-dismissing notifications">
        <View className="flex-row flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            label="Default"
            onPress={() => toast({ title: 'Heads up', description: 'Something happened.' })}
          />
          <Button
            size="sm"
            variant="outline"
            label="Success"
            onPress={() => toast({ title: 'Saved!', variant: 'success' })}
          />
          <Button
            size="sm"
            variant="outline"
            label="Error"
            onPress={() => toast({ title: 'Something broke', variant: 'error' })}
          />
          <Button
            size="sm"
            variant="outline"
            label="With action"
            onPress={() =>
              toast({
                title: 'Message archived',
                action: { label: 'Undo', onPress: () => toast({ title: 'Restored', variant: 'success' }) },
              })
            }
          />
        </View>
      </Section>

      <Section title="Overlays">
        <View className="flex-row flex-wrap gap-2">
          <Button variant="outline" label="Open dialog" onPress={() => setDialog(true)} />
          <Button variant="outline" label="Action sheet" onPress={() => setSheet(true)} />
          <Button variant="outline" label="Bottom sheet" onPress={() => setBottomSheet(true)} />
        </View>
      </Section>

      <Section title="Empty state">
        <Card>
          <EmptyState
            icon={Inbox}
            title="No notifications"
            description="When something needs your attention, it'll show up here."
            action={<Button size="sm" variant="outline" label="Refresh" />}
          />
        </Card>
      </Section>

      <Section title="Async boundary" description="loading → error → empty → data in one wrapper">
        <SegmentedControl
          value={qState}
          onValueChange={(v) => setQState(v as typeof qState)}
          options={[
            { label: 'Load', value: 'loading' },
            { label: 'Error', value: 'error' },
            { label: 'Empty', value: 'empty' },
            { label: 'Data', value: 'data' },
          ]}
        />
        <Card>
          <CardContent className="min-h-32 justify-center">
            <AsyncBoundary
              query={fakeQuery}
              isEmpty={qState === 'empty'}
              empty={<EmptyState icon={Inbox} title="No items yet" />}
            >
              <Text variant="muted">Your data renders here.</Text>
            </AsyncBoundary>
          </CardContent>
        </Card>
      </Section>

      <Section title="Error boundary" description="Catches render crashes → recoverable fallback">
        <Card>
          <CardContent className="min-h-24 justify-center">
            <ErrorBoundary key={crashKey}>
              <ErrorTrigger blow={blow} />
            </ErrorBoundary>
          </CardContent>
        </Card>
        <View className="flex-row gap-2">
          <Button size="sm" variant="destructive" label="Trigger crash" onPress={() => setBlow(true)} />
          <Button
            size="sm"
            variant="outline"
            label="Reset demo"
            onPress={() => {
              setBlow(false)
              setCrashKey((k) => k + 1)
            }}
          />
        </View>
      </Section>

      <Dialog
        visible={dialog}
        onClose={() => setDialog(false)}
        title="Delete project?"
        description="This can't be undone. All data in this project will be permanently removed."
      >
        <View className="mt-1 flex-row justify-end gap-2">
          <Button variant="ghost" label="Cancel" onPress={() => setDialog(false)} />
          <Button variant="destructive" label="Delete" onPress={() => setDialog(false)} />
        </View>
      </Dialog>

      <ActionSheet visible={sheet} onClose={() => setSheet(false)} title="Project">
        <ListItem title="Share" onPress={() => setSheet(false)} />
        <ListItem title="Duplicate" onPress={() => setSheet(false)} />
        <ListItem title="Rename" onPress={() => setSheet(false)} />
        <Button variant="ghost" label="Cancel" className="mt-1" onPress={() => setSheet(false)} />
      </ActionSheet>

      <SheetModal
        visible={bottomSheet}
        onClose={() => setBottomSheet(false)}
        snapPoints={[0.4, 0.9]}
        title="Draggable sheet"
      >
        <View className="gap-3">
          <Text variant="muted">
            Drag the handle between 40% and 90% detents, fling down to dismiss, or tap the backdrop.
            The input shows the keyboard-safe lift.
          </Text>
          <Input label="Comment" placeholder="Type to raise the keyboard…" />
          <Button label="Done" onPress={() => setBottomSheet(false)} />
        </View>
      </SheetModal>
    </PageWrapper>
  )
}
