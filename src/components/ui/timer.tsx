import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { fonts } from '@/lib/config/fonts'
import { Text } from './text'
import { Button } from './button'
import { useTimer, formatDuration } from '@/lib/hooks/use-timer'

/**
 * Timer — a self-contained stopwatch (start/pause/reset) built on useTimer. Drop it anywhere;
 * for custom layouts use the `useTimer` hook directly.
 */
export function Timer({ className }: { className?: string }) {
  const { seconds, running, start, pause, reset } = useTimer()
  return (
    <View className={cn('items-center gap-4', className)}>
      <Text
        className="text-5xl text-foreground"
        style={{ fontVariant: ['tabular-nums'], fontFamily: fonts.bold }}
      >
        {formatDuration(seconds)}
      </Text>
      <View className="flex-row gap-2">
        {running ? (
          <Button label="Pause" variant="secondary" onPress={pause} />
        ) : (
          <Button label="Start" onPress={start} />
        )}
        <Button label="Reset" variant="outline" onPress={reset} />
      </View>
    </View>
  )
}
