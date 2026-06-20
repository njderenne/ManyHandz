import { View } from 'react-native'
import { cn } from '@/lib/utils'
import { Text } from './text'

/**
 * Table — a simple data table. Define columns (with optional custom `render`) and pass rows.
 * For large/scrolling data prefer a FlatList; this is for compact, fixed tables.
 */
export type TableColumn = {
  key: string
  header: string
  align?: 'left' | 'right'
  render?: (row: Record<string, unknown>) => React.ReactNode
}

export function Table({
  columns,
  data,
  className,
}: {
  columns: TableColumn[]
  data: Record<string, unknown>[]
  className?: string
}) {
  return (
    <View className={cn('overflow-hidden rounded-lg border border-border', className)}>
      <View className="flex-row bg-muted px-3 py-2.5">
        {columns.map((c) => (
          <Text
            key={c.key}
            variant="caption"
            className={cn('flex-1 uppercase tracking-wider', c.align === 'right' && 'text-right')}
          >
            {c.header}
          </Text>
        ))}
      </View>
      {data.map((row, i) => (
        <View
          key={i}
          className={cn(
            'flex-row items-center px-3 py-3',
            i < data.length - 1 && 'border-t border-border',
          )}
        >
          {columns.map((c) => (
            <View key={c.key} className="flex-1">
              {c.render ? (
                c.render(row)
              ) : (
                <Text className={cn(c.align === 'right' && 'text-right')}>{String(row[c.key] ?? '')}</Text>
              )}
            </View>
          ))}
        </View>
      ))}
    </View>
  )
}
