import { Stack } from 'expo-router'
import { View } from 'react-native'
import { Table2 } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { HubList, type HubItem } from '@/components/gallery/hub'
import { SCHEMA_TABLES } from '@/lib/db/introspect'

/**
 * Database schema browser — every table in the live Drizzle schema, introspected from the actual
 * table objects (can't drift). Tap a table for columns, constraints, indexes, and foreign keys.
 * Reached from Settings → About → Database schema.
 */
export default function SchemaIndexScreen() {
  const items: HubItem[] = SCHEMA_TABLES.map((t) => ({
    title: t.name,
    description: `${t.columns.length} columns · ${t.indexes.length} indexes · ${t.foreignKeys.length} FKs`,
    icon: Table2,
    route: `/schema/${t.name}` as HubItem['route'],
  }))

  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: 'Database' }} />
      <View className="gap-1">
        <Text variant="h1">Database</Text>
        <Text variant="muted">
          {SCHEMA_TABLES.length} tables, introspected live from src/lib/db/schema.ts — what you see
          is what's deployed.
        </Text>
      </View>
      <HubList items={items} />
    </PageWrapper>
  )
}
