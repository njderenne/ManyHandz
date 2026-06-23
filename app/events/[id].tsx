import { useState } from 'react'
import { View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { format } from 'date-fns'
import { CalendarDays, CalendarX, MapPin, Pencil, StickyNote, Tag, Trash2, X } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Skeleton, SkeletonText } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { ApiError } from '@/lib/api/client'
import { authClient, useSession } from '@/lib/auth/client'
import { useEvent, useUpdateEvent, useDeleteEvent } from '@/lib/query/hooks/useEvents'
import { BookmarkButton } from '@/components/engagement/bookmark-button'
import { t } from '@/lib/i18n'
import type { CalendarEvent } from '@/lib/db/schema'

/**
 * Event detail — THE detail-screen worked example (pairs with app/events/index.tsx and
 * worker/routes/events.ts). Copy this screen for any resource detail: AsyncBoundary over the
 * detail query, read mode with labeled meta rows, INLINE edit mode reusing the create form's
 * field block (see app/events/new.tsx — extract a shared <EventForm> at the third usage),
 * optimistic save via the canonical update hook, delete behind a confirm Dialog, and a
 * BookmarkButton wired to the polymorphic bookmark table (entityType 'calendar_event').
 *
 * Sharing an event outside the org (a share_token deep link) is deliberately NOT built here —
 * the share-token flow is its own cluster. When it lands, a Share action joins Edit/Delete in
 * the action row below.
 */

/** Edit-mode draft — plain local state, hydrated from the cached row when Edit is tapped. */
type Draft = {
  title: string
  startsAt: Date
  endsAt: Date | null
  allDay: boolean
  location: string
  notes: string
}

/**
 * All-day rows store startsAt at UTC midnight (schema.ts convention) — read the calendar day in
 * UTC so the label/picker never drifts a day in negative-offset timezones.
 */
function allDayDate(value: CalendarEvent['startsAt']): Date {
  const d = new Date(value)
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

/** All-day convention (schema.ts): startsAt is midnight UTC of the chosen calendar day. */
function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** Hydrate an edit draft from the server row (rows arrive JSON-serialized — re-Date them). */
function draftFrom(event: CalendarEvent): Draft {
  return {
    title: event.title,
    startsAt: event.allDay ? allDayDate(event.startsAt) : new Date(event.startsAt),
    endsAt: event.endsAt ? new Date(event.endsAt) : null,
    allDay: event.allDay,
    location: event.location ?? '',
    notes: event.description ?? '',
  }
}

/** "When" line: full date, time range when present, or the all-day marker. */
function formatWhen(event: CalendarEvent): string {
  if (event.allDay) {
    return `${format(allDayDate(event.startsAt), 'EEEE, MMM d, yyyy')} · ${t('events.allDay')}`
  }
  const starts = new Date(event.startsAt)
  if (Number.isNaN(starts.getTime())) return ''
  const base = format(starts, 'EEE, MMM d, yyyy · h:mm a')
  if (!event.endsAt) return base
  const ends = new Date(event.endsAt)
  if (Number.isNaN(ends.getTime())) return base
  // Same-day range collapses to "… 2:00 PM – 3:30 PM"; cross-day repeats the full date.
  return starts.toDateString() === ends.toDateString()
    ? `${base} – ${format(ends, 'h:mm a')}`
    : `${base} – ${format(ends, 'EEE, MMM d, yyyy · h:mm a')}`
}

/** Labeled icon row for read mode — the standard "field" presentation on a detail screen. */
function MetaRow({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const colors = useColors()
  return (
    <View className="flex-row items-start gap-3">
      <View className="size-9 items-center justify-center rounded-full bg-accent">
        <Icon color={colors.mutedForeground} size={18} />
      </View>
      <View className="flex-1 gap-0.5">
        <Text variant="caption">{label}</Text>
        <Text variant="body">{value}</Text>
      </View>
    </View>
  )
}

/** Loading placeholder shaped like the detail layout. */
function DetailSkeleton() {
  return (
    <View className="gap-4">
      <Skeleton className="h-8 w-3/4" />
      <Skeleton className="h-5 w-1/2" />
      <SkeletonText lines={3} />
    </View>
  )
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const eventId = typeof id === 'string' ? id : ''
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  const query = useEvent(orgId, eventId)
  const updateEvent = useUpdateEvent(orgId)
  const deleteEvent = useDeleteEvent(orgId)
  const event = query.data

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [titleError, setTitleError] = useState<string | undefined>(undefined)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const startEditing = () => {
    if (!event) return
    setDraft(draftFrom(event))
    setTitleError(undefined)
    setEditing(true)
  }

  /** Update one draft field — keeps the JSX below readable. */
  const patchDraft = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d))

  const save = () => {
    if (!event || !draft) return
    const trimmed = draft.title.trim()
    if (!trimmed) {
      setTitleError(t('events.errorTitleRequired'))
      return
    }
    const starts = draft.allDay ? toUtcMidnight(draft.startsAt) : draft.startsAt
    const ends = draft.allDay ? null : draft.endsAt
    // Invariant checked optimistically against the LOADED snapshot — the Worker re-validates
    // against the live row, so a concurrent edit can still turn this into a 400 (the optimistic
    // patch rolls back under the error toast below; a stale merge, not a client bug).
    if (ends && ends.getTime() <= starts.getTime()) {
      toast({ title: t('events.errorEndsBeforeStarts'), variant: 'error' })
      return
    }
    updateEvent.mutate(
      {
        eventId: event.id,
        input: {
          title: trimmed,
          startsAt: starts.toISOString(),
          endsAt: ends ? ends.toISOString() : null,
          allDay: draft.allDay,
          location: draft.location.trim() || null,
          description: draft.notes.trim() || null,
        },
      },
      {
        onSuccess: () => toast({ title: t('events.saved'), variant: 'success' }),
        // The optimistic patch already rolled back (useEvents.ts) — the toast explains why.
        onError: () => toast({ title: t('events.saveFailed'), variant: 'error' }),
      },
    )
    // Leave edit mode immediately: the update hook patched the cache optimistically, so read
    // mode shows the new values now; a server rejection rolls them back under the error toast.
    setEditing(false)
  }

  const confirmDelete = () => {
    deleteEvent.mutate(eventId, {
      onSuccess: () => {
        setConfirmingDelete(false)
        toast({ title: t('events.deleted'), variant: 'success' })
        // Deep links (web URL, push tap) have no in-app history — back() would no-op and
        // leave the user staring at the just-deleted event's 404. Fall back to the list.
        if (router.canGoBack()) router.back()
        else router.replace('/events')
      },
      onError: () => {
        setConfirmingDelete(false)
        toast({ title: t('events.deleteFailed'), variant: 'error' })
      },
    })
  }

  // A deleted/stale event id is product state, not a failure — the Worker 404s, and
  // AsyncBoundary's generic error branch would offer a Retry that can never succeed.
  const notFound = query.error instanceof ApiError && query.error.status === 404
  const notFoundState = (
    <EmptyState
      icon={CalendarX}
      title={t('events.notFoundTitle')}
      description={t('events.notFoundBody')}
      action={
        <Button
          variant="outline"
          label={t('common.back')}
          // Deep links (bad/stale event id) have no history — fall back to the list.
          onPress={() => (router.canGoBack() ? router.back() : router.replace('/events'))}
        />
      }
    />
  )

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('events.detailTitle') }} />
      <PageWrapper className="gap-5 pb-24" onRefresh={() => query.refetch()}>
        {sessionPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            title={t('events.signedOutTitle')}
            description={t('events.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : notFound ? (
          notFoundState
        ) : (
          <AsyncBoundary
            query={query}
            loading={<DetailSkeleton />}
            isEmpty={!event}
            empty={notFoundState}
          >
            {event && !editing ? (
              <>
                <View className="flex-row items-start justify-between gap-3">
                  <Text variant="h2" className="flex-1">
                    {event.title}
                  </Text>
                  {/* Polymorphic bookmark — entityType names THIS table (see schema.ts bookmark);
                      the button self-wires to the bookmarks cache and toggles optimistically. */}
                  <BookmarkButton orgId={orgId} entityType="calendar_event" entityId={event.id} size={24} />
                </View>

                <Card>
                  <CardContent className="gap-4">
                    <MetaRow icon={CalendarDays} label={t('events.whenLabel')} value={formatWhen(event)} />
                    {event.location ? (
                      <MetaRow icon={MapPin} label={t('events.locationLabel')} value={event.location} />
                    ) : null}
                    {event.description ? (
                      <MetaRow icon={StickyNote} label={t('events.notesLabel')} value={event.description} />
                    ) : null}
                    {/* kind is per-app vocabulary ('appointment' | 'workout' | …) — shown raw,
                        not translated; minted apps map their vocab to labels. */}
                    {event.kind ? <MetaRow icon={Tag} label={t('events.kindLabel')} value={event.kind} /> : null}
                  </CardContent>
                </Card>

                {/* Action row — a Share action (share_token deep link) joins here when that
                    cluster lands; see the header comment. */}
                <View className="flex-row flex-wrap gap-3">
                  <Button variant="outline" icon={Pencil} label={t('events.edit')} onPress={startEditing} />
                  <Button
                    variant="destructive"
                    icon={Trash2}
                    label={t('common.delete')}
                    onPress={() => setConfirmingDelete(true)}
                  />
                </View>
              </>
            ) : event && draft ? (
              /* Edit mode — the same field block as app/events/new.tsx (extraction note in the
                 header). Draft state is local; Cancel simply drops it. */
              <Form onSubmit={save} className="gap-5">
                <Card>
                  <CardContent className="gap-4">
                    <Input
                      label={t('events.titleLabel')}
                      placeholder={t('events.titlePlaceholder')}
                      value={draft.title}
                      onChangeText={(text) => {
                        patchDraft({ title: text })
                        if (titleError) setTitleError(undefined)
                      }}
                      error={titleError}
                      maxLength={300} // mirrors the Worker's MAX_TITLE
                    />

                    <View className="flex-row items-center justify-between gap-3">
                      <View className="flex-1">
                        <Text variant="label">{t('events.allDay')}</Text>
                        <Text variant="caption">{t('events.allDayHint')}</Text>
                      </View>
                      <Switch
                        value={draft.allDay}
                        onValueChange={(value) =>
                          patchDraft({ allDay: value, ...(value ? { endsAt: null } : null) })
                        }
                        accessibilityLabel={t('events.allDay')}
                      />
                    </View>

                    <DateTimePicker
                      label={t('events.startsAtLabel')}
                      mode={draft.allDay ? 'date' : 'datetime'}
                      value={draft.startsAt}
                      onValueChange={(date) => patchDraft({ startsAt: date })}
                    />

                    {draft.allDay ? null : draft.endsAt ? (
                      <View className="gap-1.5">
                        <DateTimePicker
                          label={t('events.endsAtLabel')}
                          mode="datetime"
                          value={draft.endsAt}
                          onValueChange={(date) => patchDraft({ endsAt: date })}
                          minimumDate={draft.startsAt}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={X}
                          label={t('events.removeEndTime')}
                          onPress={() => patchDraft({ endsAt: null })}
                          className="self-start"
                        />
                      </View>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        label={t('events.addEndTime')}
                        onPress={() =>
                          patchDraft({ endsAt: new Date(draft.startsAt.getTime() + 60 * 60 * 1000) })
                        }
                        className="self-start"
                      />
                    )}

                    <Input
                      label={t('events.locationLabel')}
                      placeholder={t('events.locationPlaceholder')}
                      value={draft.location}
                      onChangeText={(text) => patchDraft({ location: text })}
                      maxLength={500} // mirrors the Worker's MAX_LOCATION
                    />
                    <Textarea
                      label={t('events.notesLabel')}
                      placeholder={t('events.notesPlaceholder')}
                      rows={4}
                      value={draft.notes}
                      onChangeText={(text) => patchDraft({ notes: text })}
                      maxLength={5000} // mirrors the Worker's MAX_DESCRIPTION
                    />
                  </CardContent>
                </Card>

                <Button label={t('common.save')} loading={updateEvent.isPending} onPress={save} />
                <Button variant="outline" label={t('common.cancel')} onPress={() => setEditing(false)} />
              </Form>
            ) : null}
          </AsyncBoundary>
        )}
      </PageWrapper>

      {/* Destructive action = explicit confirm. The Dialog scrim also closes (cancel). */}
      <Dialog
        visible={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={t('events.deleteTitle')}
        description={t('events.deleteBody')}
      >
        <View className="flex-row justify-end gap-3 pt-1">
          <Button variant="outline" label={t('common.cancel')} onPress={() => setConfirmingDelete(false)} />
          <Button
            variant="destructive"
            label={t('common.delete')}
            loading={deleteEvent.isPending}
            onPress={confirmDelete}
          />
        </View>
      </Dialog>
    </>
  )
}
