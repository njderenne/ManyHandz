import { useState } from 'react'
import { View } from 'react-native'
import { Archive, Bell, Mail, Trash2 } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Badge } from '@/components/ui/badge'
import { BadgeDot } from '@/components/ui/badge-dot'
import { Avatar } from '@/components/ui/avatar'
import { AppImage } from '@/components/ui/image'
import { SwipeableRow } from '@/components/ui/swipeable-row'
import { useColors } from '@/lib/config/theme'
import { useToast } from '@/components/ui/toast'
import { Separator } from '@/components/ui/separator'
import { List, ListItem } from '@/components/ui/list'
import { Table } from '@/components/ui/table'
import { Tabs } from '@/components/ui/tabs'
import { Accordion, AccordionItem } from '@/components/ui/accordion'
import { Progress } from '@/components/ui/progress'
import { CircularProgress } from '@/components/ui/circular-progress'
import { Carousel } from '@/components/ui/carousel'
import { Timer } from '@/components/ui/timer'
import { Card, CardContent } from '@/components/ui/card'
import { formatCurrency } from '@/lib/format/currency'
import { Section } from '@/components/gallery/kit'

/** Display tab — components that present data: badges, avatars, lists, tables, currency. */

const TABLE_COLUMNS = [
  { key: 'item', header: 'Item' },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right' as const,
    render: (row: Record<string, unknown>) => (
      <Text className="text-right">{formatCurrency(row.amount as number)}</Text>
    ),
  },
]
const TABLE_DATA = [
  { item: 'Pro plan', amount: 19.0 },
  { item: 'Add-on seats', amount: 1240.5 },
  { item: 'Credit', amount: -49.9 },
]

export default function DisplayScreen() {
  const [tab, setTab] = useState('overview')
  const colors = useColors()
  const { toast } = useToast()

  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Display</Text>

      <Section title="Badges">
        <View className="flex-row flex-wrap gap-2">
          <Badge label="Default" />
          <Badge variant="secondary" label="Secondary" />
          <Badge variant="success" label="Active" />
          <Badge variant="warning" label="Pending" />
          <Badge variant="destructive" label="Overdue" />
          <Badge variant="outline" label="Draft" />
        </View>
      </Section>

      <Section title="Badge dot" description="Notification badges pinned to icons/avatars">
        <View className="flex-row items-center gap-6">
          <BadgeDot dot>
            <Bell color={colors.mutedForeground} size={24} />
          </BadgeDot>
          <BadgeDot count={3}>
            <Bell color={colors.mutedForeground} size={24} />
          </BadgeDot>
          <BadgeDot count={120}>
            <Mail color={colors.mutedForeground} size={24} />
          </BadgeDot>
          <BadgeDot count={7}>
            <Avatar name="Will Larson" size={40} />
          </BadgeDot>
          <BadgeDot count={0}>
            <Bell color={colors.mutedForeground} size={24} />
          </BadgeDot>
        </View>
      </Section>

      <Section title="Avatars">
        <View className="flex-row items-center gap-3">
          <Avatar name="Will Larson" size={48} />
          <Avatar name="Nate Derenne" size={40} />
          <Avatar
            uri="https://i.pravatar.cc/100?img=12"
            name="Photo"
            size={40}
          />
          <Avatar name="A B" size={32} />
        </View>
      </Section>

      <Section title="List">
        <List>
          <ListItem
            title="Will Larson"
            subtitle="Owner"
            left={<Avatar name="Will Larson" size={36} />}
            right={<Badge variant="success" label="You" />}
          />
          <ListItem
            title="Nate Derenne"
            subtitle="Admin"
            left={<Avatar name="Nate Derenne" size={36} />}
          />
          <ListItem
            title="Invite teammate"
            subtitle="Send an invitation"
            onPress={() => {}}
          />
        </List>
      </Section>

      <Section title="Swipeable row" description="Swipe rows left/right for actions">
        <List>
          <SwipeableRow
            rightActions={[
              {
                icon: Archive,
                label: 'Archive',
                onPress: () => toast({ title: 'Archived' }),
              },
              {
                icon: Trash2,
                label: 'Delete',
                variant: 'destructive',
                onPress: () => toast({ title: 'Deleted', variant: 'error' }),
              },
            ]}
          >
            <ListItem title="Swipe me left" subtitle="Archive / Delete" className="bg-card" />
          </SwipeableRow>
          <SwipeableRow
            leftActions={[
              {
                icon: Mail,
                label: 'Read',
                variant: 'success',
                onPress: () => toast({ title: 'Marked read', variant: 'success' }),
              },
            ]}
          >
            <ListItem title="Swipe me right" subtitle="Mark read" className="bg-card" />
          </SwipeableRow>
        </List>
      </Section>

      <Section title="Image" description="AppImage — expo-image with blurhash + cross-fade">
        <View className="flex-row gap-3">
          <AppImage
            source={{ uri: 'https://picsum.photos/seed/appfactory/400/300' }}
            blurhash="LGF5]+Yk^6#M@-5c,1J5@[or[Q6."
            style={{ flex: 1, height: 120, borderRadius: 8 }}
            accessibilityLabel="Sample landscape photo"
          />
          <AppImage
            source={{ uri: 'https://picsum.photos/seed/factory2/200/200' }}
            blurhash="L6PZfSi_.AyE_3t7t7R**0o#DgR4"
            style={{ width: 120, height: 120, borderRadius: 8 }}
            accessibilityLabel="Sample square photo"
          />
        </View>
      </Section>

      <Section title="Table">
        <Table columns={TABLE_COLUMNS} data={TABLE_DATA} />
      </Section>

      <Section title="Tabs (in-page)">
        <Tabs
          value={tab}
          onValueChange={setTab}
          tabs={[
            { label: 'Overview', value: 'overview' },
            { label: 'Activity', value: 'activity' },
            { label: 'Settings', value: 'settings' },
          ]}
        />
        <Card>
          <CardContent>
            <Text variant="muted">Active panel: {tab}</Text>
          </CardContent>
        </Card>
      </Section>

      <Section title="Accordion">
        <Accordion>
          <AccordionItem title="What is AppFactory?" defaultOpen>
            <Text variant="muted">A template-first system for minting native apps fast.</Text>
          </AccordionItem>
          <AccordionItem title="How does billing work?">
            <Text variant="muted">Stripe on the web/subscription side; store IAP where required.</Text>
          </AccordionItem>
          <AccordionItem title="Can I cancel anytime?">
            <Text variant="muted">Yes — from the billing portal, no questions asked.</Text>
          </AccordionItem>
        </Accordion>
      </Section>

      <Section title="Progress">
        <View className="gap-3">
          <Progress value={25} />
          <Progress value={66} />
          <Progress value={100} />
        </View>
      </Section>

      <Section title="Circular progress">
        <View className="flex-row items-center gap-4">
          <CircularProgress value={72} />
          <CircularProgress value={40} size={64} strokeWidth={6} />
          <CircularProgress value={100} size={64} strokeWidth={6} />
        </View>
      </Section>

      <Section title="Carousel">
        <Carousel>
          {['Swipe through', 'Feature highlights', 'Onboarding pages'].map((t) => (
            <View key={t} className="px-1">
              <Card>
                <CardContent className="h-28 items-center justify-center">
                  <Text variant="h3">{t}</Text>
                </CardContent>
              </Card>
            </View>
          ))}
        </Carousel>
      </Section>

      <Section title="Timer" description="useTimer hook + stopwatch component">
        <Card>
          <CardContent className="py-6">
            <Timer />
          </CardContent>
        </Card>
      </Section>

      <Section title="Separator">
        <View className="gap-3">
          <Text variant="muted">Above</Text>
          <Separator />
          <Text variant="muted">Below</Text>
        </View>
      </Section>

      <Section title="Currency" description="formatCurrency — $, commas, two decimals">
        <Text variant="h2">{formatCurrency(1234.5)}</Text>
        <Card>
          <CardContent className="gap-2">
            {[0, 9.99, 1234.5, 1000000, -49.9].map((n) => (
              <View key={String(n)} className="flex-row items-center justify-between">
                <Text variant="muted">{`formatCurrency(${n})`}</Text>
                <Text variant="label">{formatCurrency(n)}</Text>
              </View>
            ))}
          </CardContent>
        </Card>
      </Section>
    </PageWrapper>
  )
}
