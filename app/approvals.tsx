import { useMemo, useState } from 'react'
import { View } from 'react-native'
import { Stack } from 'expo-router'
import { CheckCircle2, ShieldCheck, Lock, Sparkles } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { MediaImage } from '@/components/ui/media-image'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import {
  useApprovalQueue,
  useApproveCompletion,
  useRejectCompletion,
  type PendingCompletion,
} from '@/lib/query/hooks/useAssignments'
import { iconFor } from '@/lib/manyhandz/icons'

/**
 * Approvals — the FAMILY parent verification queue. A kid marks a chore done → it lands here as
 * `pending_approval` with no points awarded yet. The parent reviews the note + a 3-up
 * reference|before|after photo row, then Approves (awards points + fires the celebration push to the
 * kid) or Rejects with a required reason (sends the chore back to in_progress).
 *
 * Mode-aware: the whole queue is gated on `features.approvalWorkflow` (roommate/office are honor-system
 * and never reach here), and each write affordance is gated on `can('approveCompletions')` so a kid
 * who somehow lands here can look but not act — the Worker enforces the real check.
 */

/** Completion photos are JPEGs (per spec: compressed to 500KB .jpg), so MediaImage gets image/jpeg. */
const PHOTO_MIME = 'image/jpeg'

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (secs < 60) return 'just now'
  const mins = Math.round(secs / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.round(hrs / 24)
  return `${days}d ago`
}

/** Map an AI verdict decision to its tint + a short label for the approver. */
function aiVerdictMeta(decision: PendingCompletion['aiDecision'], colors: ReturnType<typeof useColors>) {
  switch (decision) {
    case 'auto_approved':
      return { tint: colors.success, label: 'AI: looks done' }
    case 'auto_rejected':
      return { tint: colors.destructive, label: 'AI: looks unfinished' }
    case 'flagged_for_review':
      return { tint: colors.warning, label: 'AI: needs a look' }
    default:
      return null
  }
}

/** A single photo slot in the 3-up row: label on top, the auth-fetched image or a "no photo" tile. */
function PhotoSlot({ label, mediaId }: { label: string; mediaId: string | null }) {
  const colors = useColors()
  return (
    <View className="flex-1 gap-1.5">
      <Text variant="caption" className="text-center">
        {label}
      </Text>
      {mediaId ? (
        <MediaImage
          mediaId={mediaId}
          mimeType={PHOTO_MIME}
          alt={label}
          recyclingKey={mediaId}
          style={{ width: '100%', aspectRatio: 1, borderRadius: 8 }}
        />
      ) : (
        <View
          className="items-center justify-center rounded-md border border-dashed border-border bg-card"
          style={{ width: '100%', aspectRatio: 1 }}
        >
          <Text variant="caption" style={{ color: colors.mutedForeground }}>
            None
          </Text>
        </View>
      )}
    </View>
  )
}

function CompletionCard({
  item,
  canAct,
  busy,
  onApprove,
  onReject,
}: {
  item: PendingCompletion
  canAct: boolean
  busy: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const colors = useColors()
  const ChoreIcon = iconFor(item.choreIcon)
  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-center gap-3">
          <View className="size-10 items-center justify-center rounded-xl bg-brand-500/10">
            <ChoreIcon color={colors.brand} size={22} />
          </View>
          <View className="flex-1">
            <Text variant="label">{item.choreName}</Text>
            <Text variant="muted">
              {item.memberName ?? 'A member'} · {timeAgo(item.completedAt)}
            </Text>
          </View>
          <Badge variant="warning" label={`+${item.pointsEarned}`} />
        </View>

        {item.notes ? (
          <View className="rounded-md bg-accent p-3">
            <Text variant="body">{item.notes}</Text>
          </View>
        ) : null}

        <View className="flex-row gap-2">
          <PhotoSlot label="Reference" mediaId={item.referencePhotoMediaId} />
          <PhotoSlot label="Before" mediaId={item.beforePhotoMediaId} />
          <PhotoSlot label="After" mediaId={item.afterPhotoMediaId} />
        </View>

        {/* AI verdict — score + the model's reasoning, so a flagged completion is never a black box. */}
        {(() => {
          const v = aiVerdictMeta(item.aiDecision, colors)
          if (!v) return null
          return (
            <View className="gap-1.5 rounded-xl border border-border bg-background p-3">
              <View className="flex-row items-center gap-1.5">
                <Sparkles color={v.tint} size={14} />
                <Text variant="caption" className="font-semibold text-foreground">
                  {v.label} · {item.aiScore}% sure
                  {item.aiReferenceMatch != null ? ` · ${item.aiReferenceMatch}% match to goal` : ''}
                </Text>
              </View>
              {item.aiReasoning ? <Text variant="caption">{item.aiReasoning}</Text> : null}
            </View>
          )
        })()}

        {canAct ? (
          <View className="flex-row gap-2">
            <Button
              className="flex-1"
              variant="outline"
              label="Reject"
              disabled={busy}
              onPress={onReject}
            />
            <Button className="flex-1" label="Approve" loading={busy} onPress={onApprove} />
          </View>
        ) : null}
      </CardContent>
    </Card>
  )
}

export default function ApprovalsScreen() {
  const { toast } = useToast()
  const { orgId, ready, isLoading, features, can } = useHouseholdMode()
  const queue = useApprovalQueue(orgId ?? '')
  const approve = useApproveCompletion(orgId ?? '')
  const reject = useRejectCompletion(orgId ?? '')

  const canApprove = can('approveCompletions')
  const [rejecting, setRejecting] = useState<PendingCompletion | null>(null)
  const [reason, setReason] = useState('')
  /** Tracks which completion has an in-flight mutation so only its buttons spin. */
  const [activeId, setActiveId] = useState<string | null>(null)

  // Oldest-first: the queue should drain FIFO so nothing waits forever.
  const items = useMemo(
    () =>
      [...(queue.data ?? [])].sort(
        (a, b) => new Date(a.completedAt).getTime() - new Date(b.completedAt).getTime(),
      ),
    [queue.data],
  )

  const header = <Stack.Screen options={{ headerShown: true, title: 'Approvals' }} />

  // Whole screen is mode-gated: roommate/office run on the honor system, so there is no queue.
  if (ready && !features?.approvalWorkflow) {
    return (
      <>
        {header}
        <PageWrapper>
          <EmptyState
            icon={ShieldCheck}
            title="No approvals here"
            description="This household runs on the honor system — completions are credited the moment they're marked done."
          />
        </PageWrapper>
      </>
    )
  }

  // Signed in as someone without approval rights (e.g. a kid): read-only message, no actions.
  if (ready && features?.approvalWorkflow && !canApprove) {
    return (
      <>
        {header}
        <PageWrapper>
          <EmptyState
            icon={Lock}
            title="Parents only"
            description="A parent reviews finished chores and awards the points. Hang tight!"
          />
        </PageWrapper>
      </>
    )
  }

  const onApprove = (item: PendingCompletion) => {
    setActiveId(item.id)
    approve.mutate(item.id, {
      onSuccess: () =>
        toast({ title: `Nice! ${item.choreName} approved 🎉`, description: `+${item.pointsEarned} points awarded.`, variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't approve", description: (e as Error).message, variant: 'error' }),
      onSettled: () => setActiveId(null),
    })
  }

  const openReject = (item: PendingCompletion) => {
    setReason('')
    setRejecting(item)
  }

  const submitReject = () => {
    const target = rejecting
    const trimmed = reason.trim()
    if (!target) return
    if (trimmed.length < 3) {
      toast({ title: 'Add a reason', description: 'Tell them what to fix so they can try again.', variant: 'error' })
      return
    }
    setActiveId(target.id)
    reject.mutate(
      { completionId: target.id, reason: trimmed },
      {
        onSuccess: () => {
          toast({ title: 'Sent back', description: `${target.choreName} returned for another go.`, variant: 'success' })
          setRejecting(null)
          setReason('')
        },
        onError: (e) => toast({ title: "Couldn't reject", description: (e as Error).message, variant: 'error' }),
        onSettled: () => setActiveId(null),
      },
    )
  }

  return (
    <>
      {header}
      <PageWrapper onRefresh={queue.refetch} className="pb-24">
        {isLoading || queue.isLoading || !ready ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : queue.isError ? (
          <EmptyState
            icon={ShieldCheck}
            title="Couldn't load the queue"
            description="Pull to refresh, or try again in a moment."
            action={<Button label="Retry" variant="outline" onPress={() => queue.refetch()} />}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="All caught up"
            description="Nothing waiting on you. Finished chores will land here for review."
          />
        ) : (
          <View className="gap-4">
            <Text variant="muted">
              {items.length} {items.length === 1 ? 'chore' : 'chores'} need your review · oldest first
            </Text>
            {items.map((item) => (
              <CompletionCard
                key={item.id}
                item={item}
                canAct={canApprove}
                busy={activeId === item.id}
                onApprove={() => onApprove(item)}
                onReject={() => openReject(item)}
              />
            ))}
          </View>
        )}
      </PageWrapper>

      <Dialog
        visible={rejecting !== null}
        onClose={() => setRejecting(null)}
        title="Send it back?"
        description={
          rejecting
            ? `Tell ${rejecting.memberName ?? 'them'} what to fix. The chore returns to in-progress so they can try again.`
            : undefined
        }
      >
        <View className="mt-1 gap-3">
          <Textarea
            label="Reason"
            placeholder="e.g. Looks great, but the corners still need a wipe."
            value={reason}
            onChangeText={setReason}
            rows={3}
          />
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" label="Cancel" onPress={() => setRejecting(null)} />
            <Button
              variant="destructive"
              label="Reject"
              loading={rejecting !== null && activeId === rejecting.id}
              onPress={submitReject}
            />
          </View>
        </View>
      </Dialog>
    </>
  )
}
