import { useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { X } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { authClient, useSession } from '@/lib/auth/client'
import { useCreateEvent } from '@/lib/query/hooks/useEvents'
import { t } from '@/lib/i18n'

/**
 * New event — THE create-form worked example (pairs with the list at app/events/index.tsx and
 * the detail at app/events/[id].tsx). Copy this screen for any resource create form: controlled
 * inputs, inline validation on the required field, the kit's DateTimePicker for dates, a Switch
 * for the all-day toggle, and per-call mutation callbacks for toasts (hooks stay toast-free —
 * see useEvents.ts). The same field block appears in the detail screen's edit mode; when a
 * minted app grows a THIRD usage, extract a shared <EventForm> into src/components/ instead of
 * copying again.
 *
 * Validation split: the screen pre-checks what makes a better inline experience (empty title,
 * end-before-start) and the Worker re-checks EVERYTHING — client validation is UX, server
 * validation is the contract (worker/routes/events.ts).
 */

/** Default start: the next round hour — a sensible draft that's always in the future. */
function nextHour(): Date {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  return d
}

/** All-day convention (schema.ts): startsAt is midnight UTC of the chosen calendar day. */
function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

export default function NewEventScreen() {
  const { toast } = useToast()
  const { data: session, isPending: sessionPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''
  const createEvent = useCreateEvent(orgId)

  const [title, setTitle] = useState('')
  const [titleError, setTitleError] = useState<string | undefined>(undefined)
  const [startsAt, setStartsAt] = useState<Date>(nextHour)
  // null = open-ended; the "Add end time" affordance below sets a sensible default.
  const [endsAt, setEndsAt] = useState<Date | null>(null)
  const [allDay, setAllDay] = useState(false)
  const [location, setLocation] = useState('')
  // UI says "Notes"; the API/schema column is `description` (see worker/routes/events.ts).
  const [notes, setNotes] = useState('')

  const submit = () => {
    const trimmed = title.trim()
    if (!trimmed) {
      setTitleError(t('events.errorTitleRequired'))
      return
    }
    // All-day events: pin to UTC midnight, no end time (multi-day all-day spans are per-app).
    const starts = allDay ? toUtcMidnight(startsAt) : startsAt
    const ends = allDay ? null : endsAt
    if (ends && ends.getTime() <= starts.getTime()) {
      toast({ title: t('events.errorEndsBeforeStarts'), variant: 'error' })
      return
    }
    createEvent.mutate(
      {
        title: trimmed,
        startsAt: starts.toISOString(),
        endsAt: ends ? ends.toISOString() : null,
        allDay,
        location: location.trim() || null,
        description: notes.trim() || null,
      },
      {
        // Per-call callbacks own the feedback + navigation; the hook owns the cache.
        onSuccess: (row) => {
          toast({ title: t('events.created'), variant: 'success' })
          // replace, not push — Back from the new detail should skip this spent form.
          router.replace({ pathname: '/events/[id]', params: { id: row.id } })
        },
        onError: () => toast({ title: t('events.createFailed'), variant: 'error' }),
      },
    )
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: t('events.newTitle') }} />
      <PageWrapper width="form" className="gap-5 pb-16">
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
        ) : (
          <Form onSubmit={submit} className="gap-5">
            <Card>
              <CardContent className="gap-4">
                <Input
                  label={t('events.titleLabel')}
                  placeholder={t('events.titlePlaceholder')}
                  value={title}
                  onChangeText={(text) => {
                    setTitle(text)
                    if (titleError) setTitleError(undefined) // clear the inline error on edit
                  }}
                  error={titleError}
                  maxLength={300} // mirrors the Worker's MAX_TITLE
                  autoFocus
                />

                {/* All-day flips the pickers to date-only; time would be meaningless noise. */}
                <View className="flex-row items-center justify-between gap-3">
                  <View className="flex-1">
                    <Text variant="label">{t('events.allDay')}</Text>
                    <Text variant="caption">{t('events.allDayHint')}</Text>
                  </View>
                  <Switch
                    value={allDay}
                    onValueChange={(value) => {
                      setAllDay(value)
                      if (value) setEndsAt(null)
                    }}
                    accessibilityLabel={t('events.allDay')}
                  />
                </View>

                <DateTimePicker
                  label={t('events.startsAtLabel')}
                  mode={allDay ? 'date' : 'datetime'}
                  value={startsAt}
                  onValueChange={setStartsAt}
                />

                {/* endsAt is optional — offer it instead of defaulting it, so open-ended
                    events stay the cheap common case. */}
                {allDay ? null : endsAt ? (
                  <View className="gap-1.5">
                    <DateTimePicker
                      label={t('events.endsAtLabel')}
                      mode="datetime"
                      value={endsAt}
                      onValueChange={setEndsAt}
                      minimumDate={startsAt}
                    />
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={X}
                      label={t('events.removeEndTime')}
                      onPress={() => setEndsAt(null)}
                      className="self-start"
                    />
                  </View>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    label={t('events.addEndTime')}
                    onPress={() => setEndsAt(new Date(startsAt.getTime() + 60 * 60 * 1000))}
                    className="self-start"
                  />
                )}

                <Input
                  label={t('events.locationLabel')}
                  placeholder={t('events.locationPlaceholder')}
                  value={location}
                  onChangeText={setLocation}
                  maxLength={500} // mirrors the Worker's MAX_LOCATION
                />
                <Textarea
                  label={t('events.notesLabel')}
                  placeholder={t('events.notesPlaceholder')}
                  rows={4}
                  value={notes}
                  onChangeText={setNotes}
                  maxLength={5000} // mirrors the Worker's MAX_DESCRIPTION
                />
              </CardContent>
            </Card>

            <Button label={t('events.create')} loading={createEvent.isPending} onPress={submit} />
            <Button
              variant="outline"
              label={t('common.cancel')}
              // Deep links have no in-app history — back() would no-op, so fall back to the list.
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/events'))}
            />
          </Form>
        )}
      </PageWrapper>
    </>
  )
}
