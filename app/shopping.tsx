import { useMemo, useState } from 'react'
import { View, Pressable, ScrollView } from 'react-native'
import { Stack } from 'expo-router'
import { Plus, ShoppingCart, MoreHorizontal, Archive, Check, Trash2 } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Tabs } from '@/components/ui/tabs'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/ui/empty-state'
import { Dialog } from '@/components/ui/dialog'
import { ActionSheet } from '@/components/ui/action-sheet'
import { ListItem } from '@/components/ui/list'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { cn } from '@/lib/utils'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { iconFor } from '@/lib/manyhandz/icons'
import {
  SHOPPING_CATEGORIES,
  useShoppingLists,
  useShoppingItems,
  useCreateShoppingList,
  useUpdateShoppingList,
  useAddShoppingItem,
  useCheckShoppingItem,
  useDeleteShoppingItem,
  type ShoppingCategory,
} from '@/lib/query/hooks/useShopping'
import type { ShoppingList, ShoppingItem } from '@/lib/db/schema'

/**
 * Shopping — shared supply lists for the whole household. A list switcher (tabs) over the active
 * lists, items grouped by category with check-off (strike + move to a Checked section), and a
 * quick-add that lets the Worker auto-categorize. Shopping is a universal feature: every member
 * reads AND writes (the Worker gates on membership), so there's no feature flag or permission gate —
 * only the "signed-in + has a household" gate that every screen shares.
 */

/** Human label for a stored category key. */
const CATEGORY_LABELS: Record<ShoppingCategory, string> = {
  produce: 'Produce',
  dairy: 'Dairy',
  meat: 'Meat & Seafood',
  bakery: 'Bakery',
  frozen: 'Frozen',
  pantry: 'Pantry',
  beverages: 'Beverages',
  snacks: 'Snacks',
  cleaning: 'Cleaning',
  household: 'Household',
  personal: 'Personal Care',
  pets: 'Pets',
  other: 'Other',
}

function categoryLabel(key: string | null): string {
  return (key && CATEGORY_LABELS[key as ShoppingCategory]) || 'Other'
}

export default function ShoppingScreen() {
  const { orgId, ready, isLoading } = useHouseholdMode()

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Shopping' }} />
      <PageWrapper className="gap-5 pb-28">
        {isLoading ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !orgId || !ready ? (
          <EmptyState
            icon={ShoppingCart}
            title="Join a household first"
            description="Shared shopping lists live in a household. Create or join one to start a list."
          />
        ) : (
          <ShoppingBoard orgId={orgId} />
        )}
      </PageWrapper>
    </>
  )
}

/** The live board once we know the household. Owns list selection + the quick-add + manage sheet. */
function ShoppingBoard({ orgId }: { orgId: string }) {
  const { toast } = useToast()
  const colors = useColors()
  const lists = useShoppingLists(orgId)
  const createList = useCreateShoppingList(orgId)
  const updateList = useUpdateShoppingList(orgId)

  const [activeId, setActiveId] = useState<string | null>(null)
  const [newListOpen, setNewListOpen] = useState(false)
  const [newListName, setNewListName] = useState('')
  const [manageOpen, setManageOpen] = useState(false)

  const active = useMemo<ShoppingList[]>(
    () => (lists.data ?? []).filter((l) => !l.isArchived).sort((a, b) => a.sortOrder - b.sortOrder),
    [lists.data],
  )
  const selectedId = activeId && active.some((l) => l.id === activeId) ? activeId : active[0]?.id ?? null
  const selected = active.find((l) => l.id === selectedId) ?? null

  const onCreateList = () => {
    const name = newListName.trim()
    if (!name) {
      toast({ title: 'Name your list first', variant: 'error' })
      return
    }
    createList.mutate(
      { name },
      {
        onSuccess: (list) => {
          setActiveId(list.id)
          setNewListName('')
          setNewListOpen(false)
        },
        onError: (e) => toast({ title: "Couldn't create list", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const onArchive = () => {
    if (!selected) return
    updateList.mutate(
      { listId: selected.id, input: { isArchived: true } },
      {
        onSuccess: () => {
          setManageOpen(false)
          setActiveId(null)
          toast({ title: 'List archived', variant: 'success' })
        },
        onError: (e) => toast({ title: "Couldn't archive", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  if (lists.isLoading) {
    return (
      <View className="items-center py-24">
        <Spinner size="large" />
      </View>
    )
  }

  if (lists.isError) {
    return (
      <EmptyState
        icon={ShoppingCart}
        title="Couldn't load lists"
        description="Check your connection and pull to refresh."
        action={<Button size="sm" variant="outline" label="Retry" onPress={() => lists.refetch()} />}
      />
    )
  }

  return (
    <View className="gap-5">
      <View className="flex-row items-center justify-between gap-2">
        {active.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
            <Tabs
              value={selectedId ?? ''}
              onValueChange={setActiveId}
              tabs={active.map((l) => ({ label: l.name, value: l.id }))}
            />
          </ScrollView>
        ) : (
          <View className="flex-1" />
        )}
        {selected ? (
          <Pressable
            onPress={() => setManageOpen(true)}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Manage list"
            className="size-9 items-center justify-center rounded-full active:bg-accent"
          >
            <MoreHorizontal color={colors.mutedForeground} size={20} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setNewListOpen(true)}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="New list"
          className="size-9 items-center justify-center rounded-full active:bg-accent"
        >
          <Plus color={colors.primary} size={22} />
        </Pressable>
      </View>

      {selected ? (
        <ListPane orgId={orgId} list={selected} />
      ) : (
        <EmptyState
          icon={ShoppingCart}
          title="No lists yet"
          description="Create your first shared list — groceries, supplies, anything the household needs."
          action={<Button size="sm" label="New list" onPress={() => setNewListOpen(true)} />}
        />
      )}

      <Dialog
        visible={newListOpen}
        onClose={() => setNewListOpen(false)}
        title="New list"
        description="Everyone in your household can see and edit it."
      >
        <View className="mt-1 gap-3">
          <Input
            placeholder="Groceries, Costco, Hardware…"
            value={newListName}
            onChangeText={setNewListName}
            autoFocus
            onSubmitEditing={onCreateList}
            returnKeyType="done"
          />
          <View className="flex-row justify-end gap-2">
            <Button variant="ghost" label="Cancel" onPress={() => setNewListOpen(false)} />
            <Button label="Create" loading={createList.isPending} onPress={onCreateList} />
          </View>
        </View>
      </Dialog>

      <ActionSheet visible={manageOpen} onClose={() => setManageOpen(false)} title={selected?.name ?? 'List'}>
        <ListItem
          title="Archive list"
          subtitle="Hide it without deleting items"
          left={<Archive color={colors.mutedForeground} size={20} />}
          onPress={onArchive}
        />
        <Button variant="ghost" label="Cancel" className="mt-1" onPress={() => setManageOpen(false)} />
      </ActionSheet>
    </View>
  )
}

/** One list's items: grouped-by-category checklist + the Checked section + quick-add. */
function ListPane({ orgId, list }: { orgId: string; list: ShoppingList }) {
  const { toast } = useToast()
  const items = useShoppingItems(orgId, list.id)
  const addItem = useAddShoppingItem(orgId, list.id)
  const checkItem = useCheckShoppingItem(orgId, list.id)
  const deleteItem = useDeleteShoppingItem(orgId, list.id)
  const [draft, setDraft] = useState('')

  const { groups, checked } = useMemo(() => {
    const all = items.data ?? []
    const checkedItems = all.filter((i) => i.isChecked)
    const open = all.filter((i) => !i.isChecked)
    const byCat = new Map<string, ShoppingItem[]>()
    for (const it of open) {
      const key = it.category ?? 'other'
      const bucket = byCat.get(key) ?? []
      bucket.push(it)
      byCat.set(key, bucket)
    }
    const ordered = SHOPPING_CATEGORIES.filter((c) => byCat.has(c)).map((c) => ({
      category: c as string,
      items: byCat.get(c)!,
    }))
    return { groups: ordered, checked: checkedItems }
  }, [items.data])

  const onAdd = () => {
    const name = draft.trim()
    if (!name) return
    setDraft('')
    // Omit `category` so the Worker keyword-categorizes the name.
    addItem.mutate(
      { name },
      { onError: (e) => toast({ title: "Couldn't add item", description: (e as Error).message, variant: 'error' }) },
    )
  }

  if (items.isLoading) {
    return (
      <View className="items-center py-16">
        <Spinner />
      </View>
    )
  }

  const isEmpty = groups.length === 0 && checked.length === 0

  return (
    <View className="gap-4">
      <View className="flex-row items-end gap-2">
        <Input
          containerClassName="flex-1"
          placeholder="Add an item…"
          value={draft}
          onChangeText={setDraft}
          onSubmitEditing={onAdd}
          returnKeyType="done"
          autoCapitalize="sentences"
        />
        <Button label="Add" disabled={!draft.trim() || addItem.isPending} onPress={onAdd} />
      </View>

      {isEmpty ? (
        <EmptyState
          icon={iconFor(list.icon)}
          title="Nothing on the list"
          description="Type an item above — we'll sort it into the right aisle automatically."
        />
      ) : (
        <View className="gap-4">
          {groups.map((group) => (
            <CategoryGroup
              key={group.category}
              category={group.category}
              items={group.items}
              onToggle={(item) => checkItem.mutate({ itemId: item.id, isChecked: true })}
            />
          ))}

          {checked.length > 0 ? (
            <View className="gap-2">
              <Text variant="caption" className="uppercase tracking-wider">
                Checked · {checked.length}
              </Text>
              <Card>
                <CardContent className="gap-1 p-2">
                  {checked.map((item) => (
                    <CheckedRow
                      key={item.id}
                      item={item}
                      onUncheck={() => checkItem.mutate({ itemId: item.id, isChecked: false })}
                      onDelete={() => deleteItem.mutate(item.id)}
                    />
                  ))}
                </CardContent>
              </Card>
            </View>
          ) : null}
        </View>
      )}
    </View>
  )
}

/** A category bucket of unchecked items with check-off boxes. */
function CategoryGroup({
  category,
  items,
  onToggle,
}: {
  category: string
  items: ShoppingItem[]
  onToggle: (item: ShoppingItem) => void
}) {
  return (
    <View className="gap-2">
      <View className="flex-row items-center gap-2">
        <Text variant="label">{categoryLabel(category)}</Text>
        <Badge variant="outline" label={String(items.length)} />
      </View>
      <Card>
        <CardContent className="gap-1 p-2">
          {items.map((item) => (
            <Pressable
              key={item.id}
              onPress={() => onToggle(item)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: false }}
              accessibilityLabel={item.name}
              className="flex-row items-center gap-3 rounded-md px-2 py-2.5 active:bg-accent"
            >
              <Checkbox checked={false} onCheckedChange={() => onToggle(item)} />
              <View className="flex-1">
                <Text variant="body">{item.name}</Text>
                {item.note ? <Text variant="caption">{item.note}</Text> : null}
              </View>
              {item.quantity ? <Text variant="muted">{item.quantity}</Text> : null}
            </Pressable>
          ))}
        </CardContent>
      </Card>
    </View>
  )
}

/** A checked-off item: strikethrough, dimmed, with uncheck + delete. */
function CheckedRow({
  item,
  onUncheck,
  onDelete,
}: {
  item: ShoppingItem
  onUncheck: () => void
  onDelete: () => void
}) {
  const colors = useColors()
  return (
    <View className="flex-row items-center gap-3 rounded-md px-2 py-2.5 opacity-60">
      <Pressable
        onPress={onUncheck}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: true }}
        accessibilityLabel={item.name}
        className="size-6 items-center justify-center rounded-md border border-primary bg-primary active:opacity-80"
      >
        <Check color={colors.onPrimary} size={16} strokeWidth={3} />
      </Pressable>
      <Text variant="body" className={cn('flex-1 line-through')}>
        {item.name}
      </Text>
      <Pressable
        onPress={onDelete}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${item.name}`}
        className="size-8 items-center justify-center rounded-full active:bg-accent"
      >
        <Trash2 color={colors.mutedForeground} size={18} />
      </Pressable>
    </View>
  )
}
