import * as Calendar from 'expo-calendar/legacy'

/**
 * Device calendar — write events to the phone's built-in calendar (the "add to my calendar" tap).
 * Requests permission, picks the default writable calendar. Returns the created event id, or null
 * if permission is denied / there's no writable calendar. Native module → next build.
 */
export type CalendarEvent = {
  title: string
  startDate: Date
  endDate: Date
  notes?: string
  location?: string
  allDay?: boolean
}

async function defaultCalendarId(): Promise<string | null> {
  const cals = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT)
  const writable = cals.find((c) => c.allowsModifications)
  return writable?.id ?? cals[0]?.id ?? null
}

export async function addToCalendar(event: CalendarEvent): Promise<string | null> {
  const { status } = await Calendar.requestCalendarPermissionsAsync()
  if (status !== 'granted') return null
  const calendarId = await defaultCalendarId()
  if (!calendarId) return null
  return Calendar.createEventAsync(calendarId, {
    title: event.title,
    startDate: event.startDate,
    endDate: event.endDate,
    notes: event.notes,
    location: event.location,
    allDay: event.allDay,
  })
}
