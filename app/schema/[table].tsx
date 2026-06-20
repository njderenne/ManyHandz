import { Stack, useLocalSearchParams } from 'expo-router'
import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Section } from '@/components/gallery/kit'
import { Table2 } from 'lucide-react-native'
import { getTable } from '@/lib/db/introspect'

/** Table detail — columns (types + constraints), indexes, foreign keys, unique constraints. */
export default function SchemaTableScreen() {
  const { table: name } = useLocalSearchParams<{ table: string }>()
  const table = name ? getTable(name) : undefined

  if (!table) {
    return (
      <PageWrapper className="gap-6 pb-24">
        <Stack.Screen options={{ headerShown: true, title: 'Table' }} />
        <EmptyState icon={Table2} title="Unknown table" description={`No table named "${name}" in the schema.`} />
      </PageWrapper>
    )
  }

  return (
    <PageWrapper className="gap-8 pb-24">
      <Stack.Screen options={{ headerShown: true, title: table.name }} />
      <View className="gap-1">
        <Text variant="h1">{table.name}</Text>
        <Text variant="muted">
          {table.columns.length} columns · {table.indexes.length} indexes · {table.foreignKeys.length} foreign keys
        </Text>
      </View>

      <Section title="Columns">
        <Card>
          <CardContent className="gap-3">
            {table.columns.map((col) => (
              <View key={col.name} className="gap-1">
                <View className="flex-row flex-wrap items-center gap-2">
                  <Text variant="label">{col.name}</Text>
                  {col.isPrimary ? <Badge label="PK" variant="default" /> : null}
                  {col.notNull && !col.isPrimary ? <Badge label="NOT NULL" variant="outline" /> : null}
                  {col.hasDefault ? <Badge label="DEFAULT" variant="outline" /> : null}
                </View>
                <Text variant="caption">{col.sqlType}</Text>
              </View>
            ))}
          </CardContent>
        </Card>
      </Section>

      {table.foreignKeys.length > 0 ? (
        <Section title="Foreign keys">
          <Card>
            <CardContent className="gap-3">
              {table.foreignKeys.map((fk, i) => (
                <View key={i} className="gap-0.5">
                  <Text variant="label">
                    {fk.columns.join(', ')} → {fk.references}
                  </Text>
                  {fk.onDelete ? <Text variant="caption">on delete {fk.onDelete}</Text> : null}
                </View>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      {table.indexes.length > 0 ? (
        <Section title="Indexes">
          <Card>
            <CardContent className="gap-3">
              {table.indexes.map((idx) => (
                <View key={idx.name} className="gap-0.5">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text variant="label">{idx.name}</Text>
                    {idx.unique ? <Badge label="UNIQUE" variant="outline" /> : null}
                  </View>
                  <Text variant="caption">({idx.columns.join(', ')})</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}

      {table.uniqueConstraints.length > 0 ? (
        <Section title="Unique constraints">
          <Card>
            <CardContent className="gap-3">
              {table.uniqueConstraints.map((u) => (
                <View key={u.name} className="gap-0.5">
                  <Text variant="label">{u.name}</Text>
                  <Text variant="caption">({u.columns.join(', ')})</Text>
                </View>
              ))}
            </CardContent>
          </Card>
        </Section>
      ) : null}
    </PageWrapper>
  )
}
