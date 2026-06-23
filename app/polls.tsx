import { useEffect, useState } from 'react'
import { View, Pressable } from 'react-native'
import { router, Stack } from 'expo-router'
import { BarChart3, Megaphone, Plus, Check, Lock, EyeOff, Pin, Clock, Trash2 } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Progress } from '@/components/ui/progress'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Dialog } from '@/components/ui/dialog'
import { FAB } from '@/components/ui/fab'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { accentHex } from '@/lib/manyhandz/accents'
import { cn } from '@/lib/utils'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import {
  usePolls,
  useCreatePoll,
  useVotePoll,
  useClosePoll,
  type PollResult,
  type CreatePollInput,
} from '@/lib/query/hooks/usePolls'
import {
  useAnnouncements,
  useCreateAnnouncement,
  useDeleteAnnouncement,
  type AnnouncementPriority,
  type AnnouncementInput,
} from '@/lib/query/hooks/useAnnouncements'
import type { Announcement } from '@/lib/db/schema'

/**
 * Polls & Notices — two sections (Polls / Announcements) the whole household can read; writing is
 * gated on `can('editHouseholdSettings')` (parents in Family, any roommate in Roommate — never kids),
 * mirroring the Worker. Polls are voteable cards with live result bars (vote toggles via useVotePoll,
 * respecting allowMultiple + isAnonymous, and lock when isClosed / closesAt passes). Announcements are
 * pinned notices with a priority accent; admins create and un-pin (soft-delete) them. Pushed route;
 * both create forms live in in-screen Dialogs (single-file route, so the nav stays put).
 */

type Section = 'polls' | 'announcements'

/** Priority → accent key (resolved to a hex via accentHex — never a raw literal) + badge variant. */
const PRIORITY_META: Record<AnnouncementPriority, { label: string; accent: string; badge: BadgeProps['variant'] }> = {
  urgent: { label: 'Urgent', accent: 'rose', badge: 'destructive' },
  important: { label: 'Important', accent: 'amber', badge: 'warning' },
  normal: { label: 'Normal', accent: 'slate', badge: 'secondary' },
}

const PRIORITY_OPTIONS = (['normal', 'important', 'urgent'] as AnnouncementPriority[]).map((value) => ({
  value,
  label: PRIORITY_META[value].label,
}))

/** Live "now" tick (per-minute) so a poll's closesAt flips to closed without a manual refresh. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function isPollClosed(poll: PollResult, now: number): boolean {
  if (poll.isClosed) return true
  if (poll.closesAt) return new Date(poll.closesAt).getTime() <= now
  return false
}

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

function PollCard({
  poll,
  orgId,
  canManage,
  now,
}: {
  poll: PollResult
  orgId: string
  canManage: boolean
  now: number
}) {
  const colors = useColors()
  const { toast } = useToast()
  const vote = useVotePoll(orgId)
  const close = useClosePoll(orgId)
  const closed = isPollClosed(poll, now)
  const total = poll.totalVotes

  const onVote = (optionId: string) => {
    if (closed || vote.isPending) return
    vote.mutate(
      { pollId: poll.id, optionId },
      { onError: (e) => toast({ title: "Couldn't record your vote", description: (e as Error).message, variant: 'error' }) },
    )
  }

  const onClose = () => {
    close.mutate(poll.id, {
      onSuccess: () => toast({ title: 'Poll closed', variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't close poll", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Card>
      <CardContent className="gap-3">
        <View className="flex-row items-start gap-2">
          <Text variant="label" className="flex-1">{poll.question}</Text>
          {closed ? (
            <Badge variant="outline" label="Closed" />
          ) : poll.allowMultiple ? (
            <Badge variant="secondary" label="Multi" />
          ) : null}
        </View>

        <View className="flex-row flex-wrap items-center gap-2">
          {poll.isAnonymous ? (
            <View className="flex-row items-center gap-1">
              <EyeOff size={13} color={colors.mutedForeground} />
              <Text variant="caption">Anonymous</Text>
            </View>
          ) : null}
          {poll.closesAt && !closed ? (
            <View className="flex-row items-center gap-1">
              <Clock size={13} color={colors.mutedForeground} />
              <Text variant="caption">Closes {new Date(poll.closesAt).toLocaleDateString()}</Text>
            </View>
          ) : null}
        </View>

        <View className="gap-2.5">
          {poll.options.map((opt) => {
            const pct = total > 0 ? Math.round((opt.votes / total) * 100) : 0
            const mine = poll.myVotes.includes(opt.id)
            return (
              <Pressable
                key={opt.id}
                disabled={closed || vote.isPending}
                onPress={() => onVote(opt.id)}
                accessibilityRole="button"
                accessibilityLabel={`${opt.text}, ${opt.votes} votes`}
                accessibilityState={{ selected: mine, disabled: closed }}
                className={cn('gap-1.5 rounded-md p-2', !closed && 'active:bg-accent', closed && 'opacity-90')}
              >
                <View className="flex-row items-center justify-between gap-2">
                  <View className="flex-1 flex-row items-center gap-1.5">
                    {mine ? <Check size={15} color={colors.primary} /> : null}
                    <Text variant={mine ? 'label' : 'body'} numberOfLines={1} className="flex-1">
                      {opt.text}
                    </Text>
                  </View>
                  <Text variant="caption" className="tabular-nums">{opt.votes} · {pct}%</Text>
                </View>
                <Progress value={pct} className={mine ? undefined : 'opacity-60'} />
              </Pressable>
            )
          })}
        </View>

        <View className="flex-row items-center justify-between">
          <Text variant="caption">{total} {total === 1 ? 'vote' : 'votes'}</Text>
          {canManage && !closed ? (
            <Button size="sm" variant="ghost" label="Close poll" icon={Lock} loading={close.isPending} onPress={onClose} />
          ) : null}
        </View>
      </CardContent>
    </Card>
  )
}

/** Create-poll Dialog (2–6 options). Rendered only when the caller can manage. */
function CreatePollDialog({ orgId, visible, onClose }: { orgId: string; visible: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreatePoll(orgId)
  const [question, setQuestion] = useState('')
  const [options, setOptions] = useState<string[]>(['', ''])
  const [allowMultiple, setAllowMultiple] = useState(false)
  const [isAnonymous, setIsAnonymous] = useState(false)
  const [closesAt, setClosesAt] = useState<Date | undefined>()

  const reset = () => {
    setQuestion('')
    setOptions(['', ''])
    setAllowMultiple(false)
    setIsAnonymous(false)
    setClosesAt(undefined)
  }
  const close = () => {
    reset()
    onClose()
  }

  const setOptionAt = (i: number, value: string) => setOptions((prev) => prev.map((o, idx) => (idx === i ? value : o)))
  const addOption = () => setOptions((prev) => (prev.length < 6 ? [...prev, ''] : prev))
  const removeOption = (i: number) => setOptions((prev) => (prev.length > 2 ? prev.filter((_, idx) => idx !== i) : prev))

  const submit = () => {
    const cleaned = options.map((o) => o.trim()).filter(Boolean)
    if (!question.trim()) {
      toast({ title: 'Ask a question first', variant: 'error' })
      return
    }
    if (cleaned.length < 2) {
      toast({ title: 'Add at least two options', variant: 'error' })
      return
    }
    const input: CreatePollInput = {
      question: question.trim(),
      options: cleaned,
      allowMultiple,
      isAnonymous,
      closesAt: closesAt ? closesAt.toISOString() : null,
    }
    create.mutate(input, {
      onSuccess: () => {
        toast({ title: 'Poll posted', variant: 'success' })
        close()
      },
      onError: (e) => toast({ title: "Couldn't post poll", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Dialog visible={visible} onClose={close} title="New poll" className="max-w-md">
      <Form onSubmit={submit} className="gap-4">
        <Input label="Question" placeholder="Pizza or tacos this Friday?" maxLength={200} value={question} onChangeText={setQuestion} />

        <View className="gap-2">
          <Text variant="label">Options ({options.length}/6)</Text>
          {options.map((opt, i) => (
            <View key={i} className="flex-row items-center gap-2">
              <Input
                containerClassName="flex-1"
                placeholder={`Option ${i + 1}`}
                value={opt}
                onChangeText={(v) => setOptionAt(i, v)}
              />
              {options.length > 2 ? (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={Trash2}
                  accessibilityLabel={`Remove option ${i + 1}`}
                  onPress={() => removeOption(i)}
                />
              ) : null}
            </View>
          ))}
          {options.length < 6 ? (
            <Button size="sm" variant="outline" label="Add option" icon={Plus} onPress={addOption} />
          ) : null}
        </View>

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text variant="label">Allow multiple</Text>
            <Text variant="caption">Voters can pick more than one option.</Text>
          </View>
          <Switch value={allowMultiple} onValueChange={setAllowMultiple} accessibilityLabel="Allow multiple votes" />
        </View>

        <View className="flex-row items-center justify-between gap-3">
          <View className="flex-1">
            <Text variant="label">Anonymous</Text>
            <Text variant="caption">Hide who voted for what.</Text>
          </View>
          <Switch value={isAnonymous} onValueChange={setIsAnonymous} accessibilityLabel="Anonymous voting" />
        </View>

        <DateTimePicker
          label="Auto-close (optional)"
          mode="datetime"
          value={closesAt}
          onValueChange={setClosesAt}
          minimumDate={new Date()}
          placeholder="Stays open until closed"
        />

        <Button label="Post poll" loading={create.isPending} onPress={submit} />
      </Form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

function AnnouncementCard({ notice, orgId, canManage }: { notice: Announcement; orgId: string; canManage: boolean }) {
  const { toast } = useToast()
  const remove = useDeleteAnnouncement(orgId)
  const meta = PRIORITY_META[(notice.priority as AnnouncementPriority)] ?? PRIORITY_META.normal
  const accent = accentHex(meta.accent)
  const created = new Date(notice.createdAt)

  const onUnpin = () => {
    remove.mutate(notice.id, {
      onSuccess: () => toast({ title: 'Notice removed', variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't remove notice", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Card style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
      <CardContent className="gap-2">
        <View className="flex-row items-start gap-2">
          <View className="flex-1 gap-1">
            <Text variant="label">{notice.title}</Text>
            {notice.body ? <Text variant="muted">{notice.body}</Text> : null}
          </View>
          <Badge variant={meta.badge} label={meta.label} />
        </View>
        <View className="flex-row items-center justify-between">
          <Text variant="caption">
            {Number.isNaN(created.getTime()) ? '' : created.toLocaleDateString()}
            {notice.expiresAt ? ` · expires ${new Date(notice.expiresAt).toLocaleDateString()}` : ''}
          </Text>
          {canManage ? (
            <Button
              size="sm"
              variant="ghost"
              label="Un-pin"
              icon={Pin}
              loading={remove.isPending}
              onPress={onUnpin}
            />
          ) : null}
        </View>
      </CardContent>
    </Card>
  )
}

/** Create-announcement Dialog. Rendered only when the caller can manage. */
function CreateAnnouncementDialog({ orgId, visible, onClose }: { orgId: string; visible: boolean; onClose: () => void }) {
  const { toast } = useToast()
  const create = useCreateAnnouncement(orgId)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [priority, setPriority] = useState<AnnouncementPriority>('normal')
  const [expiresAt, setExpiresAt] = useState<Date | undefined>()

  const reset = () => {
    setTitle('')
    setBody('')
    setPriority('normal')
    setExpiresAt(undefined)
  }
  const close = () => {
    reset()
    onClose()
  }

  const submit = () => {
    if (!title.trim()) {
      toast({ title: 'Give your notice a title', variant: 'error' })
      return
    }
    const input: AnnouncementInput = {
      title: title.trim(),
      body: body.trim() || null,
      priority,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
    }
    create.mutate(input, {
      onSuccess: () => {
        toast({ title: 'Notice posted', variant: 'success' })
        close()
      },
      onError: (e) => toast({ title: "Couldn't post notice", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <Dialog visible={visible} onClose={close} title="New announcement" className="max-w-md">
      <Form onSubmit={submit} className="gap-4">
        <Input label="Title" placeholder="Trash goes out tonight" value={title} onChangeText={setTitle} />
        <Textarea label="Details" placeholder="Anything the household should know (optional)" rows={3} value={body} onChangeText={setBody} />
        <Select label="Priority" options={PRIORITY_OPTIONS} value={priority} onValueChange={(v) => setPriority(v as AnnouncementPriority)} />
        <DateTimePicker
          label="Expires (optional)"
          mode="datetime"
          value={expiresAt}
          onValueChange={setExpiresAt}
          minimumDate={new Date()}
          placeholder="Stays pinned until removed"
        />
        <Button label="Post notice" loading={create.isPending} onPress={submit} />
      </Form>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------

const SECTION_META: Record<Section, { label: string; icon: LucideIcon }> = {
  polls: { label: 'Polls', icon: BarChart3 },
  announcements: { label: 'Notices', icon: Megaphone },
}

export default function PollsScreen() {
  const colors = useColors()
  const { orgId, ready, isLoading, can } = useHouseholdMode()
  const now = useNow()
  const [section, setSection] = useState<Section>('polls')
  const [createOpen, setCreateOpen] = useState(false)

  const pollsQuery = usePolls(orgId ?? '')
  const noticesQuery = useAnnouncements(orgId ?? '')
  const query = section === 'polls' ? pollsQuery : noticesQuery
  // Writes for both surfaces share the admin permission (the Worker gates on editHouseholdSettings).
  const canManage = can('editHouseholdSettings')

  // No active household → nudge to onboarding (mirrors the shape used across the app).
  if (!orgId && !isLoading) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Polls & Notices' }} />
        <PageWrapper className="pb-24">
          <EmptyState
            icon={BarChart3}
            title="No household yet"
            description="Create or join a household to run polls and post notices."
            action={<Button label="Get started" onPress={() => router.push('/onboarding')} />}
          />
        </PageWrapper>
      </>
    )
  }

  const SectionIcon = SECTION_META[section].icon

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Polls & Notices' }} />
      <PageWrapper className="pb-24" onRefresh={() => query.refetch()}>
        {!ready ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : (
          <>
            <View className="gap-1">
              <View className="flex-row items-center gap-2">
                <SectionIcon size={22} color={colors.brand} />
                <Text variant="h1">Polls & Notices</Text>
              </View>
              <Text variant="muted">Quick votes and pinned household announcements.</Text>
            </View>

            <SegmentedControl
              value={section}
              onValueChange={(v) => setSection(v as Section)}
              options={[
                { label: 'Polls', value: 'polls' },
                { label: 'Announcements', value: 'announcements' },
              ]}
            />

            {section === 'polls' ? (
              <AsyncBoundary
                query={pollsQuery}
                isEmpty={(pollsQuery.data?.length ?? 0) === 0}
                empty={
                  <EmptyState
                    icon={BarChart3}
                    title="No polls yet"
                    description={canManage ? 'Start a quick vote to settle a household decision.' : 'Polls your household creates will show up here.'}
                    action={canManage ? <Button label="New poll" icon={Plus} onPress={() => setCreateOpen(true)} /> : undefined}
                  />
                }
              >
                <View className="gap-3">
                  {(pollsQuery.data ?? []).map((poll) => (
                    <PollCard key={poll.id} poll={poll} orgId={orgId!} canManage={canManage} now={now} />
                  ))}
                </View>
              </AsyncBoundary>
            ) : (
              <AsyncBoundary
                query={noticesQuery}
                isEmpty={(noticesQuery.data?.length ?? 0) === 0}
                empty={
                  <EmptyState
                    icon={Megaphone}
                    title="No announcements"
                    description={canManage ? 'Pin a notice to keep everyone in the loop.' : 'Pinned notices will show up here.'}
                    action={canManage ? <Button label="New notice" icon={Plus} onPress={() => setCreateOpen(true)} /> : undefined}
                  />
                }
              >
                <View className="gap-3">
                  {(noticesQuery.data ?? []).map((notice) => (
                    <AnnouncementCard key={notice.id} notice={notice} orgId={orgId!} canManage={canManage} />
                  ))}
                </View>
              </AsyncBoundary>
            )}
          </>
        )}
      </PageWrapper>

      {ready && canManage ? (
        <FAB
          icon={Plus}
          onPress={() => setCreateOpen(true)}
          accessibilityLabel={section === 'polls' ? 'New poll' : 'New announcement'}
        />
      ) : null}

      {orgId && canManage && section === 'polls' ? (
        <CreatePollDialog orgId={orgId} visible={createOpen} onClose={() => setCreateOpen(false)} />
      ) : null}
      {orgId && canManage && section === 'announcements' ? (
        <CreateAnnouncementDialog orgId={orgId} visible={createOpen} onClose={() => setCreateOpen(false)} />
      ) : null}
    </>
  )
}
