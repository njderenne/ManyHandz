import { useMemo, useState } from 'react'
import { View, Pressable } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import {
  CalendarDays,
  Camera,
  Check,
  CircleCheck,
  Clock,
  ImageIcon,
  PartyPopper,
  Play,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
  XCircle,
} from 'lucide-react-native'
import { MotiView } from 'moti'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import {
  useAssignment,
  useUpdateAssignment,
  useCompleteAssignment,
  useVerifyCompletionPhoto,
  type AssignmentWithChore,
  type CompleteInput,
  type AiVerdict,
  type PhotoCheckResult,
} from '@/lib/query/hooks/useAssignments'
import { useComments, useAddComment } from '@/lib/query/hooks/useComments'
import { computePoints } from '@/lib/manyhandz/points'
import { iconFor } from '@/lib/manyhandz/icons'
import { accentHex } from '@/lib/manyhandz/accents'
import { pickImage, takePhoto } from '@/lib/native/image-picker'
import { uploadMedia, MediaNotConfiguredError } from '@/lib/media/upload'
import { haptics } from '@/lib/native/haptics'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Checkbox } from '@/components/ui/checkbox'
import { Progress } from '@/components/ui/progress'
import { Rating } from '@/components/ui/rating'
import { Stepper } from '@/components/ui/stepper'
import { Textarea } from '@/components/ui/textarea'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { SheetModal } from '@/components/ui/sheet'
import { Dialog } from '@/components/ui/dialog'
import { MediaImage } from '@/components/ui/media-image'
import { AppImage } from '@/components/ui/image'
import { useToast } from '@/components/ui/toast'

/** Map an assignment status to a Badge variant + label (clean text for both modes). */
function statusBadge(status: string): { variant: 'default' | 'secondary' | 'success' | 'warning' | 'destructive'; label: string } {
  switch (status) {
    case 'completed':
      return { variant: 'success', label: 'Done' }
    case 'in_progress':
      return { variant: 'default', label: 'In progress' }
    case 'overdue':
      return { variant: 'destructive', label: 'Overdue' }
    case 'skipped':
      return { variant: 'secondary', label: 'Skipped' }
    case 'pending_review':
    case 'snoozed_pending_approval':
      return { variant: 'warning', label: 'Waiting for a parent' }
    default:
      return { variant: 'secondary', label: 'To do' }
  }
}

/** Format a YYYY-MM-DD (+ optional HH:MM) into a friendly local label. */
function dueLabel(dueDate: string, dueTime: string | null): string {
  const [y, m, d] = dueDate.split('-').map(Number)
  if (!y || !m || !d) return dueDate
  const base = new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return dueTime ? `${base} · ${dueTime}` : base
}

/** Difficulty as 1–5 stars (family) or Easy/Medium/Hard text (roommate/office) per ui config. */
function DifficultyDisplay({ difficulty, display }: { difficulty: number; display: 'stars' | 'text' }) {
  if (display === 'stars') return <Rating value={difficulty} max={5} size={16} readOnly />
  const text = difficulty <= 2 ? 'Easy' : difficulty <= 3 ? 'Medium' : 'Hard'
  return <Badge variant="outline" label={text} />
}

export default function AssignmentDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const assignmentId = typeof id === 'string' ? id : ''
  const colors = useColors()
  const { toast } = useToast()
  const { orgId, ready, features, ui, can, household } = useHouseholdMode()

  const assignmentQuery = useAssignment(orgId ?? '', assignmentId)
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const commentsQuery = useComments(orgId ?? '', assignmentId)

  const update = useUpdateAssignment(orgId ?? '')
  const complete = useCompleteAssignment(orgId ?? '')
  const addComment = useAddComment(orgId ?? '', assignmentId)

  const assignment = assignmentQuery.data
  const assignee = useMemo(
    () => membersQuery.data?.find((m) => m.memberId === assignment?.assignedToMemberId),
    [membersQuery.data, assignment?.assignedToMemberId],
  )

  if (!ready) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Assignment' }} />
        <PageWrapper>
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        </PageWrapper>
      </>
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: assignment?.choreName ?? 'Assignment' }} />
      <PageWrapper className="gap-5 pb-24" onRefresh={() => assignmentQuery.refetch()}>
        <AsyncBoundary query={assignmentQuery}>
          {assignment ? (
            <AssignmentBody
              assignment={assignment}
              orgId={orgId!}
              assigneeName={assignee?.displayName ?? null}
              assigneeAvatar={assignee?.avatarUrl ?? null}
              assigneeColor={assignee?.favoriteColor ?? null}
              assigneeStreak={assignee?.currentStreak ?? 0}
              features={features!}
              ui={ui!}
              canComplete={can('markOwnComplete')}
              canPhoto={can('submitPhotoProof')}
              requirePhotoProof={household?.requirePhotoProof ?? false}
              update={update}
              complete={complete}
              comments={commentsQuery}
              addComment={addComment}
              toast={toast}
              colors={colors}
            />
          ) : null}
        </AsyncBoundary>
      </PageWrapper>
    </>
  )
}

type BodyProps = {
  assignment: AssignmentWithChore
  orgId: string
  assigneeName: string | null
  assigneeAvatar: string | null
  assigneeColor: string | null
  assigneeStreak: number
  features: NonNullable<ReturnType<typeof useHouseholdMode>['features']>
  ui: NonNullable<ReturnType<typeof useHouseholdMode>['ui']>
  canComplete: boolean
  canPhoto: boolean
  requirePhotoProof: boolean
  update: ReturnType<typeof useUpdateAssignment>
  complete: ReturnType<typeof useCompleteAssignment>
  comments: ReturnType<typeof useComments>
  addComment: ReturnType<typeof useAddComment>
  toast: ReturnType<typeof useToast>['toast']
  colors: ReturnType<typeof useColors>
}

function AssignmentBody(props: BodyProps) {
  const { assignment, ui, features, canComplete, colors } = props
  const ChoreIcon = iconFor(assignment.choreIcon)
  const badge = statusBadge(assignment.status)
  const isDone = assignment.status === 'completed'
  const isWaiting = assignment.status === 'pending_review' || assignment.status === 'snoozed_pending_approval'
  const inProgress = assignment.status === 'in_progress'
  // Photos only matter when the household requires proof OR the chore is AI-verified. Otherwise no
  // photo UI appears at all (a plain checklist + notes completion).
  const needsPhotoProof = props.requirePhotoProof || assignment.aiVerificationEnabled

  const [sheetOpen, setSheetOpen] = useState(false)
  const [success, setSuccess] = useState<{ points: number; needsApproval: boolean; aiVerdict: AiVerdict | null } | null>(null)

  const checklistDone = assignment.checklistProgress.filter((s) => s.done).length
  const checklistTotal = assignment.checklistProgress.length
  const checklistPct = checklistTotal ? (checklistDone / checklistTotal) * 100 : 0

  const toggleStep = (index: number, done: boolean) => {
    if (!canComplete || isDone) return
    const next = assignment.checklistProgress.map((s, i) => (i === index ? { ...s, done } : s))
    haptics.selection()
    props.update.mutate({ id: assignment.id, input: { checklistProgress: next } })
  }

  const onStart = () => {
    haptics.light()
    props.update.mutate(
      { id: assignment.id, input: { status: 'in_progress' } },
      { onError: (e) => props.toast({ title: "Couldn't start", description: (e as Error).message, variant: 'error' }) },
    )
  }

  return (
    <>
      {/* Header card: icon · name · difficulty · due · status · assignee */}
      <Card>
        <CardContent className="gap-4 pt-4">
          <View className="flex-row items-center gap-3">
            <View className="size-12 items-center justify-center rounded-2xl bg-primary/10">
              <ChoreIcon color={colors.primary} size={26} />
            </View>
            <View className="flex-1 gap-1">
              <Text variant="h3">{assignment.choreName}</Text>
              <DifficultyDisplay difficulty={assignment.difficulty} display={ui.difficultyDisplay} />
            </View>
            <Badge variant={badge.variant} label={badge.label} />
          </View>

          <View className="flex-row flex-wrap gap-x-5 gap-y-2">
            <View className="flex-row items-center gap-1.5">
              <CalendarDays color={colors.mutedForeground} size={16} />
              <Text variant="muted">{dueLabel(assignment.dueDate, assignment.dueTime)}</Text>
            </View>
            <View className="flex-row items-center gap-1.5">
              <Clock color={colors.mutedForeground} size={16} />
              <Text variant="muted">{assignment.estimatedMinutes} min</Text>
            </View>
          </View>

          <View className="flex-row items-center gap-2 border-t border-border pt-3">
            <Avatar uri={props.assigneeAvatar ?? undefined} name={props.assigneeName ?? '?'} size={28} />
            <Text variant="muted">{props.assigneeName ?? 'Unassigned'}</Text>
            {props.assigneeColor ? (
              <View className="size-2.5 rounded-full" style={{ backgroundColor: accentHex(props.assigneeColor) }} />
            ) : null}
          </View>
        </CardContent>
      </Card>

      {/* "The Goal" — reference photo */}
      {assignment.referencePhotoMediaId ? (
        <GoalCard mediaId={assignment.referencePhotoMediaId} playful={ui.tonePlayful} colors={colors} />
      ) : null}

      {/* Waiting-for-approval state */}
      {isWaiting ? (
        <Card>
          <CardContent className="items-center gap-2 py-6">
            <View className="size-14 items-center justify-center rounded-full bg-warning/15">
              <ShieldCheck color={colors.warning} size={26} />
            </View>
            <Text variant="h3">Waiting for a parent</Text>
            <Text variant="muted" className="text-center">
              Your completion was submitted. You will earn your points once it is approved.
            </Text>
          </CardContent>
        </Card>
      ) : null}

      {/* Checklist */}
      {checklistTotal > 0 ? (
        <View className="gap-3">
          <View className="flex-row items-center justify-between">
            <Text variant="label">Checklist</Text>
            <Text variant="caption">
              {checklistDone}/{checklistTotal}
            </Text>
          </View>
          <Progress value={checklistPct} />
          <Card>
            <CardContent className="gap-1 py-2">
              {assignment.checklistProgress.map((step, i) => (
                <Pressable
                  key={`${step.label}-${i}`}
                  onPress={() => toggleStep(i, !step.done)}
                  disabled={!canComplete || isDone}
                  className="flex-row items-center gap-3 py-2 active:opacity-80"
                >
                  <Checkbox
                    checked={step.done}
                    onCheckedChange={(v) => toggleStep(i, v)}
                    disabled={!canComplete || isDone}
                  />
                  <Text className={cn('flex-1', step.done && 'text-muted-foreground line-through')}>{step.label}</Text>
                </Pressable>
              ))}
            </CardContent>
          </Card>
        </View>
      ) : null}

      {/* Before photo (photo-proof chores only) — captured as you start; shown read-only at completion. */}
      {needsPhotoProof && props.canPhoto && !isDone && !isWaiting ? (
        <BeforePhotoCard
          assignmentId={assignment.id}
          beforePhotoMediaId={assignment.beforePhotoMediaId}
          update={props.update}
          toast={props.toast}
          colors={colors}
        />
      ) : null}

      {/* Action affordances — only when the viewer may complete and it isn't already done/waiting */}
      {canComplete && !isDone && !isWaiting ? (
        <View className="gap-2">
          {!inProgress ? (
            <Button icon={Play} label="Start" variant="outline" loading={props.update.isPending} onPress={onStart} />
          ) : null}
          <Button icon={Check} label="Mark Done" onPress={() => setSheetOpen(true)} />
        </View>
      ) : null}

      {isDone ? (
        <Card>
          <CardContent className="flex-row items-center gap-2 py-4">
            <CircleCheck color={colors.success} size={20} />
            <Text variant="muted">This chore is complete. Nice work!</Text>
          </CardContent>
        </Card>
      ) : null}

      {/* Comments thread */}
      <CommentsThread
        comments={props.comments}
        addComment={props.addComment}
        toast={props.toast}
        colors={colors}
      />

      {/* Completion sheet */}
      <CompletionSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        assignment={assignment}
        features={features}
        canPhoto={props.canPhoto}
        needsPhotoProof={needsPhotoProof}
        streak={props.assigneeStreak}
        complete={props.complete}
        toast={props.toast}
        colors={colors}
        onCompleted={(points, needsApproval, aiVerdict) => {
          setSheetOpen(false)
          setSuccess({ points, needsApproval, aiVerdict })
        }}
      />

      {/* Success celebration — confetti (family) vs checkmark (roommate) per ui.completionAnimation */}
      <SuccessDialog
        result={success}
        onClose={() => setSuccess(null)}
        animation={ui.completionAnimation}
        colors={colors}
      />
    </>
  )
}

function GoalCard({ mediaId, playful, colors }: { mediaId: string; playful: boolean; colors: ReturnType<typeof useColors> }) {
  const [zoom, setZoom] = useState(false)
  return (
    <>
      <View className="gap-2">
        <View className="flex-row items-center gap-1.5">
          <Target color={colors.primary} size={16} />
          <Text variant="label">The Goal</Text>
        </View>
        <Pressable onPress={() => setZoom(true)} accessibilityRole="imagebutton" accessibilityLabel="View reference photo">
          <MediaImage mediaId={mediaId} mimeType="image/jpeg" style={{ width: '100%', height: 200, borderRadius: 12 }} />
        </Pressable>
        {playful ? <Text variant="caption">Make it look like this!</Text> : null}
      </View>
      <Dialog visible={zoom} onClose={() => setZoom(false)} title="The Goal" className="max-w-md">
        <MediaImage mediaId={mediaId} mimeType="image/jpeg" style={{ width: '100%', height: 320, borderRadius: 12 }} />
      </Dialog>
    </>
  )
}

type PhotoSlot = { uri: string | null; mediaId: string | null; uploading: boolean }
const EMPTY_SLOT: PhotoSlot = { uri: null, mediaId: null, uploading: false }

function CompletionSheet(props: {
  visible: boolean
  onClose: () => void
  assignment: AssignmentWithChore
  features: NonNullable<ReturnType<typeof useHouseholdMode>['features']>
  canPhoto: boolean
  needsPhotoProof: boolean
  streak: number
  complete: ReturnType<typeof useCompleteAssignment>
  toast: ReturnType<typeof useToast>['toast']
  colors: ReturnType<typeof useColors>
  onCompleted: (points: number, needsApproval: boolean, aiVerdict: AiVerdict | null) => void
}) {
  const { assignment, features, canPhoto, needsPhotoProof, colors } = props
  const [after, setAfter] = useState<PhotoSlot>(EMPTY_SLOT)
  const [notes, setNotes] = useState('')
  const [trackTime, setTrackTime] = useState(false)
  const [minutes, setMinutes] = useState(assignment.estimatedMinutes)
  const [mediaDisabled, setMediaDisabled] = useState(false)
  const { orgId } = useHouseholdMode()
  const verifyPhoto = useVerifyCompletionPhoto(orgId ?? '')
  // The AI verdict the user is reviewing (after a photo check) but hasn't committed yet.
  const [review, setReview] = useState<PhotoCheckResult | null>(null)

  // The "before" was captured at start (on the assignment); here the assignee adds the "after".
  const photoCount = (assignment.beforePhotoMediaId ? 1 : 0) + (after.mediaId ? 1 : 0)
  const photosArg: 'both' | 'one' | 'none' = photoCount === 2 ? 'both' : photoCount === 1 ? 'one' : 'none'

  // Live points preview using the canonical engine (mirrors the server award).
  const preview = useMemo(
    () =>
      computePoints({
        difficulty: assignment.difficulty,
        estimatedMinutes: assignment.estimatedMinutes,
        actualMinutes: trackTime && features.speedBonus ? minutes : null,
        currentStreak: props.streak,
        photos: photosArg,
      }),
    [assignment.difficulty, assignment.estimatedMinutes, trackTime, features.speedBonus, minutes, props.streak, photosArg],
  )

  // Photo proof only shows for chores that need it; the assignee adds the "after" here.
  const showPhotos = needsPhotoProof && canPhoto && !mediaDisabled

  const attachAfter = async (source: 'library' | 'camera') => {
    const uri = source === 'camera' ? await takePhoto() : await pickImage()
    if (!uri) return
    setAfter({ uri, mediaId: null, uploading: true })
    try {
      const media = await uploadMedia(uri)
      setAfter({ uri, mediaId: media.id, uploading: false })
    } catch (e) {
      if (e instanceof MediaNotConfiguredError) {
        setMediaDisabled(true)
        setAfter(EMPTY_SLOT)
        props.toast({ title: 'Photos are not enabled', description: 'You can still finish without a photo.', variant: 'default' })
      } else {
        setAfter(EMPTY_SLOT)
        props.toast({ title: "Couldn't upload photo", description: (e as Error).message, variant: 'error' })
      }
    }
  }

  const uploading = after.uploading

  const onSubmit = (verificationToken?: string | null) => {
    const input: CompleteInput = {
      beforePhotoMediaId: assignment.beforePhotoMediaId,
      afterPhotoMediaId: after.mediaId,
      notes: notes.trim() || null,
      actualMinutes: trackTime && features.speedBonus ? minutes : null,
      verificationToken: verificationToken ?? null,
    }
    props.complete.mutate(
      { assignmentId: assignment.id, input },
      {
        onSuccess: (res) => {
          if (res.aiVerdict?.decision === 'auto_rejected') haptics.warning()
          else haptics.success()
          props.onCompleted(res.breakdown.total, res.needsApproval, res.aiVerdict)
        },
        onError: (e) => props.toast({ title: "Couldn't complete", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  // AI-verification chores: check the after photo FIRST (no commit) so the user sees the verdict and
  // decides to fix-and-retake or send as-is. If the check itself errors, just submit it for review.
  const onCheck = () => {
    if (!after.mediaId) return
    verifyPhoto.mutate(
      { assignmentId: assignment.id, afterPhotoMediaId: after.mediaId, beforePhotoMediaId: assignment.beforePhotoMediaId },
      {
        onSuccess: (res) => setReview(res),
        onError: () => {
          props.toast({ title: "Couldn't check the photo", description: 'Submitting it for review instead.', variant: 'default' })
          onSubmit()
        },
      },
    )
  }

  const onRetake = () => {
    setReview(null)
    setAfter(EMPTY_SLOT)
  }

  return (
    <SheetModal visible={props.visible} onClose={props.onClose} snapPoints={[0.7, 0.95]} title="Mark done">
      <View className="gap-5">
        {/* Live points preview */}
        <Card>
          <CardContent className="flex-row items-center justify-between py-4">
            <View>
              <Text variant="caption">You will earn</Text>
              <Text variant="h2">{preview.total} pts</Text>
            </View>
            <View className="items-end gap-0.5">
              <Text variant="caption">Base {preview.base}</Text>
              {preview.streakBonus > 0 ? <Text variant="caption">Streak +{preview.streakBonus}</Text> : null}
              {preview.speedBonus > 0 ? <Text variant="caption">Speed +{preview.speedBonus}</Text> : null}
              {preview.photoBonus > 0 ? <Text variant="caption">Photos +{preview.photoBonus}</Text> : null}
            </View>
          </CardContent>
        </Card>

        {/* Photo proof — the "before" (captured at start, read-only) + the "after" (added here). */}
        {showPhotos ? (
          <View className="gap-2">
            <Text variant="label">Photo proof</Text>
            <View className="flex-row gap-3">
              <View className="flex-1 gap-1.5">
                <Text variant="caption">Before</Text>
                <View className="aspect-square overflow-hidden rounded-xl border border-border bg-card">
                  {assignment.beforePhotoMediaId ? (
                    <MediaImage mediaId={assignment.beforePhotoMediaId} mimeType="image/jpeg" style={{ width: '100%', height: '100%' }} />
                  ) : (
                    <View className="flex-1 items-center justify-center px-2">
                      <Text variant="caption" className="text-center">No before photo</Text>
                    </View>
                  )}
                </View>
              </View>
              <PhotoTile label="After" slot={after} colors={colors} onPick={() => attachAfter('library')} onShoot={() => attachAfter('camera')} />
            </View>
          </View>
        ) : null}

        {/* Notes */}
        <Textarea label="Notes (optional)" placeholder="Anything to add?" rows={3} value={notes} onChangeText={setNotes} maxLength={500} />

        {/* Timer / actual minutes (only where the mode awards a speed bonus) */}
        {features.speedBonus ? (
          <View className="gap-2">
            <Pressable onPress={() => setTrackTime((v) => !v)} className="flex-row items-center gap-3 active:opacity-80">
              <Checkbox checked={trackTime} onCheckedChange={setTrackTime} />
              <Text className="flex-1">Track how long it took</Text>
            </Pressable>
            {trackTime ? (
              <View className="flex-row items-center justify-between">
                <Text variant="muted">Actual minutes</Text>
                <Stepper value={minutes} onValueChange={setMinutes} min={1} max={480} />
              </View>
            ) : null}
          </View>
        ) : null}

        {review ? (
          // The user has an AI verdict in hand — show it + the fix-or-send choice (nothing committed yet).
          <ReviewPanel
            review={review}
            colors={colors}
            busy={props.complete.isPending}
            onRetake={onRetake}
            onSubmit={() => onSubmit(review.token)}
          />
        ) : assignment.aiVerificationEnabled && after.mediaId ? (
          // AI chore + an after photo → check it before committing.
          <Button
            icon={Sparkles}
            label="Check & complete"
            loading={verifyPhoto.isPending}
            disabled={uploading || verifyPhoto.isPending}
            onPress={onCheck}
          />
        ) : (
          <Button
            icon={Send}
            label="Complete chore"
            loading={props.complete.isPending}
            disabled={uploading || props.complete.isPending}
            onPress={() => onSubmit()}
          />
        )}
        {uploading ? <Text variant="caption" className="text-center">Uploading photo…</Text> : null}
      </View>
    </SheetModal>
  )
}

/**
 * In-sheet verdict panel — the heart of the "check before you commit" flow. After the photo check it
 * shows the AI's read (score + reasoning) and the user's choice: a clean pass just finishes; otherwise
 * "fix it & retake" (redo the photo) or "send for approval anyway" (override → a human reviews). The
 * token rides the submit so the server applies this exact verdict.
 */
function ReviewPanel({
  review,
  colors,
  busy,
  onRetake,
  onSubmit,
}: {
  review: PhotoCheckResult
  colors: ReturnType<typeof useColors>
  busy: boolean
  onRetake: () => void
  onSubmit: () => void
}) {
  const v = review.verdict
  const approved = v.decision === 'auto_approved'
  const rejected = v.decision === 'auto_rejected'
  const tint = approved ? colors.success : rejected ? colors.destructive : colors.warning
  const heading = approved
    ? 'Looks done!'
    : rejected
      ? "This doesn't look finished"
      : 'Almost — this will need approval'
  return (
    <View className="gap-3">
      <View className="gap-1.5 rounded-xl border p-3" style={{ borderColor: `${tint}55`, backgroundColor: `${tint}11` }}>
        <View className="flex-row items-center gap-1.5">
          <Sparkles color={tint} size={16} />
          <Text variant="label" style={{ color: tint }}>
            {heading}
          </Text>
        </View>
        <Text variant="caption" className="font-semibold text-foreground">
          {v.score}% sure{v.referenceMatch != null ? ` · ${v.referenceMatch}% match to goal` : ''}
        </Text>
        <Text variant="caption">{v.reasoning}</Text>
      </View>
      {approved ? (
        <Button icon={Send} label="Finish" loading={busy} onPress={onSubmit} />
      ) : (
        <View className="gap-2">
          <Button label="Send for approval anyway" loading={busy} onPress={onSubmit} />
          <Button variant="outline" label="Fix it & retake photo" disabled={busy} onPress={onRetake} />
        </View>
      )}
    </View>
  )
}

function PhotoTile({
  label,
  slot,
  colors,
  onPick,
  onShoot,
}: {
  label: string
  slot: PhotoSlot
  colors: ReturnType<typeof useColors>
  onPick: () => void
  onShoot: () => void
}) {
  return (
    <View className="flex-1 gap-1.5">
      <Text variant="caption">{label}</Text>
      <View className="aspect-square overflow-hidden rounded-xl border border-border bg-card">
        {slot.uri ? (
          // Local picked/captured URI — not auth-gated, so AppImage (not MediaImage) previews it.
          <AppImage source={{ uri: slot.uri }} recyclingKey={slot.uri} style={{ width: '100%', height: '100%' }} />
        ) : null}
        {slot.uploading ? (
          <View className="absolute inset-0 items-center justify-center bg-black/30">
            <Spinner />
          </View>
        ) : null}
        {!slot.uri ? (
          <View className="flex-1 items-center justify-center">
            <ImageIcon color={colors.mutedForeground} size={22} />
          </View>
        ) : null}
      </View>
      <View className="flex-row gap-1.5">
        <Button size="sm" variant="outline" icon={ImageIcon} className="flex-1" onPress={onPick} accessibilityLabel={`Pick ${label} photo`} />
        <Button size="sm" variant="outline" icon={Camera} className="flex-1" onPress={onShoot} accessibilityLabel={`Take ${label} photo`} />
      </View>
    </View>
  )
}

/** Before-photo capture (photo-proof chores) — taken as you START the chore; the "after" is added at
 *  completion. Uploads, then PATCHes assignment.beforePhotoMediaId (assignee self-service). */
function BeforePhotoCard(props: {
  assignmentId: string
  beforePhotoMediaId: string | null
  update: ReturnType<typeof useUpdateAssignment>
  toast: ReturnType<typeof useToast>['toast']
  colors: ReturnType<typeof useColors>
}) {
  const [uploading, setUploading] = useState(false)
  const capture = async (source: 'library' | 'camera') => {
    const uri = source === 'camera' ? await takePhoto() : await pickImage()
    if (!uri) return
    setUploading(true)
    try {
      const media = await uploadMedia(uri)
      props.update.mutate({ id: props.assignmentId, input: { beforePhotoMediaId: media.id } })
    } catch (e) {
      if (e instanceof MediaNotConfiguredError) {
        props.toast({ title: 'Photos are not enabled', description: 'You can finish without one.', variant: 'default' })
      } else {
        props.toast({ title: "Couldn't upload photo", description: (e as Error).message, variant: 'error' })
      }
    } finally {
      setUploading(false)
    }
  }
  return (
    <Card>
      <CardContent className="gap-3 py-4">
        <View className="flex-row items-center gap-2">
          <Camera color={props.colors.primary} size={18} />
          <Text variant="label">Before photo</Text>
        </View>
        <Text variant="caption">Snap a quick &quot;before&quot; now — you&apos;ll add the &quot;after&quot; when you finish.</Text>
        {props.beforePhotoMediaId ? (
          <View className="aspect-video overflow-hidden rounded-xl border border-border bg-card">
            <MediaImage mediaId={props.beforePhotoMediaId} mimeType="image/jpeg" style={{ width: '100%', height: '100%' }} />
          </View>
        ) : null}
        <View className="flex-row gap-2">
          <Button
            size="sm"
            variant="outline"
            icon={ImageIcon}
            label={props.beforePhotoMediaId ? 'Replace' : 'Choose'}
            className="flex-1"
            loading={uploading}
            onPress={() => capture('library')}
          />
          <Button size="sm" variant="outline" icon={Camera} label="Camera" className="flex-1" loading={uploading} onPress={() => capture('camera')} />
        </View>
      </CardContent>
    </Card>
  )
}

function CommentsThread(props: {
  comments: ReturnType<typeof useComments>
  addComment: ReturnType<typeof useAddComment>
  toast: ReturnType<typeof useToast>['toast']
  colors: ReturnType<typeof useColors>
}) {
  const [draft, setDraft] = useState('')
  const list = props.comments.data ?? []

  const send = () => {
    const body = draft.trim()
    if (!body) return
    props.addComment.mutate(body, {
      onSuccess: () => setDraft(''),
      onError: (e) => props.toast({ title: "Couldn't post", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <View className="gap-3">
      <Text variant="label">Comments</Text>
      <AsyncBoundary
        query={props.comments}
        isEmpty={list.length === 0}
        empty={<EmptyState title="No comments yet" description="Start the conversation below." />}
      >
        <View className="gap-2">
          {list.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex-row gap-3 py-3">
                <Avatar uri={c.avatarUrl ?? undefined} name={c.memberName ?? '?'} size={32} />
                <View className="flex-1 gap-0.5">
                  <Text variant="label">{c.memberName ?? 'Member'}</Text>
                  <Text variant="muted">{c.body}</Text>
                </View>
              </CardContent>
            </Card>
          ))}
        </View>
      </AsyncBoundary>

      <View className="flex-row items-end gap-2">
        <Textarea
          containerClassName="flex-1"
          placeholder="Add a comment…"
          rows={2}
          value={draft}
          onChangeText={setDraft}
          maxLength={500}
        />
        <Button icon={Send} loading={props.addComment.isPending} disabled={!draft.trim()} onPress={send} accessibilityLabel="Post comment" />
      </View>
    </View>
  )
}

function SuccessDialog({
  result,
  onClose,
  animation,
  colors,
}: {
  result: { points: number; needsApproval: boolean; aiVerdict: AiVerdict | null } | null
  onClose: () => void
  animation: 'confetti' | 'checkmark'
  colors: ReturnType<typeof useColors>
}) {
  if (!result) return null
  const v = result.aiVerdict
  const rejected = v?.decision === 'auto_rejected'

  // A rejection is NOT a celebration — red, no confetti, "try again". Flagged/needs-approval is amber;
  // a clean pass (AI or not) gets the celebratory treatment.
  const Icon = rejected ? XCircle : result.needsApproval ? ShieldCheck : animation === 'confetti' ? PartyPopper : CircleCheck
  const tint = rejected ? colors.destructive : result.needsApproval ? colors.warning : colors.success
  const title = rejected
    ? 'Not quite yet'
    : result.needsApproval
      ? v
        ? 'Sent for review'
        : 'Sent for approval'
      : animation === 'confetti'
        ? 'Way to go!'
        : 'Chore done'
  const body = rejected
    ? 'Take another look and give it another try — see the note below.'
    : result.needsApproval
      ? v
        ? `An adult will take a quick look. You'll earn ${result.points} points once it's approved.`
        : `You will earn ${result.points} points once a parent approves.`
      : `You earned ${result.points} points.`

  return (
    <Dialog visible={Boolean(result)} onClose={onClose} showClose={false}>
      <View className="items-center gap-3 py-2">
        <MotiView
          from={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', damping: 12, stiffness: 200 }}
          className="size-16 items-center justify-center rounded-full"
          style={{ backgroundColor: `${tint}22` }}
        >
          <Icon color={tint} size={32} />
        </MotiView>
        <Text variant="h3">{title}</Text>
        <Text variant="muted" className="text-center">
          {body}
        </Text>

        {/* AI verdict — score + the model's one-line reasoning, so the call is never a black box. */}
        {v ? (
          <View className="w-full gap-1.5 rounded-xl border border-border bg-card p-3">
            <View className="flex-row items-center gap-1.5">
              <Sparkles color={tint} size={14} />
              <Text variant="caption" className="font-semibold text-foreground">
                AI photo check · {v.score}% sure
                {v.referenceMatch != null ? ` · ${v.referenceMatch}% match to goal` : ''}
              </Text>
            </View>
            <Text variant="caption">{v.reasoning}</Text>
          </View>
        ) : null}

        <Button label={rejected ? 'Try again' : 'Done'} className="mt-1 self-stretch" onPress={onClose} />
      </View>
    </Dialog>
  )
}
