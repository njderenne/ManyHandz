import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { addToCalendar } from '@/lib/native/calendar'
import { APP_CONFIG } from '@/lib/config/app'

/** Calendar tester — drops a sample event into the phone's built-in calendar. */

function CalendarTester() {
  const { state, run } = useAsyncAction()
  return (
    <View className="gap-3">
      <Button
        label="Add sample event to phone calendar"
        loading={state.status === 'loading'}
        onPress={() =>
          run(async () => {
            const start = new Date(Date.now() + 86_400_000)
            const end = new Date(start.getTime() + 3_600_000)
            const id = await addToCalendar({
              title: `${APP_CONFIG.name} reminder`,
              startDate: start,
              endDate: end,
              notes: 'Added from the template.',
            })
            return id ? 'Added to your calendar' : 'Permission denied / no calendar'
          })
        }
      />
      <Result state={state} />
    </View>
  )
}

export default function CalendarScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Calendar</Text>
      <Section title="Calendar — device" description="Drop an event into the phone's built-in calendar">
        <CalendarTester />
      </Section>
    </PageWrapper>
  )
}
