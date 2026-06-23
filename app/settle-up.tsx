import { useMemo, useState } from 'react'
import { Linking, View } from 'react-native'
import { Stack } from 'expo-router'
import {
  ArrowRight, Coins, Gift, IceCream, KeyRound, PartyPopper, Plus, Sparkles, Wallet,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Tabs } from '@/components/ui/tabs'
import { Dialog } from '@/components/ui/dialog'
import { ActionSheet } from '@/components/ui/action-sheet'
import { ListItem } from '@/components/ui/list'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { formatCents } from '@/lib/format/currency'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { useHousehold, useHouseholdMembers } from '@/lib/query/hooks/useHousehold'
import {
  paymentDeepLink, useCreateSettlement, useForgiveSettlement, useSettlements, useSettleSettlement,
  type PaymentMethod, type PayoutType, type SettledVia, type SettlementRow,
} from '@/lib/query/hooks/useSettlements'

/**
 * Settle Up — the household ledger for money AND non-money obligations (treats, privileges,
 * experiences). Balance summary per member pair, filter tabs, a pending list the debtor settles
 * (money: pick a method → open the payment deep link → mark paid; non-money: mark fulfilled) and
 * the creditor/parent forgives, settled history, and a manual-IOU create flow. Mode-aware: payment
 * deep links only surface where the household has paymentHandles on; who may file an IOU mirrors the
 * Worker (parents in family; any peer in roommate/office). The Worker enforces — this only affords.
 */

const PAYOUT_ICON: Record<PayoutType, LucideIcon> = {
  money: Coins, treat: IceCream, gift: Gift, privilege: KeyRound, experience: PartyPopper,
  custom: Sparkles,
}

const SOURCE_LABEL: Record<string, string> = {
  goal_payout: 'Goal', competition: 'Competition', reward_redemption: 'Reward',
  allowance: 'Allowance', manual: 'Manual',
}

const FILTER_TABS: { label: string; value: 'all' | PayoutType }[] = [
  { label: 'All', value: 'all' },
  { label: 'Money', value: 'money' },
  { label: 'Treats', value: 'treat' },
  { label: 'Privileges', value: 'privilege' },
  { label: 'Experiences', value: 'experience' },
]

/** Deep-link methods first, then the manual-record ones (always available, even without handles). */
const DEEP_LINK_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'venmo', label: 'Venmo' },
  { value: 'paypal', label: 'PayPal' },
  { value: 'cashapp', label: 'Cash App' },
  { value: 'apple_cash', label: 'Apple Cash' },
]
const MANUAL_METHODS: { value: SettledVia; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'in_person', label: 'In person' },
  { value: 'other', label: 'Other' },
]

const PAYOUT_OPTIONS = [
  { label: 'Money', value: 'money' },
  { label: 'Treat', value: 'treat' },
  { label: 'Gift', value: 'gift' },
  { label: 'Privilege', value: 'privilege' },
  { label: 'Experience', value: 'experience' },
  { label: 'Custom', value: 'custom' },
]

function amountLabel(row: SettlementRow): string {
  return row.payoutType === 'money'
    ? formatCents(row.amountCents ?? 0)
    : (row.payoutDescription ?? row.description)
}

export default function SettleUpScreen() {
  const colors = useColors()
  const { toast } = useToast()
  const { orgId, ready, isLoading, features, can } = useHouseholdMode()
  const [filter, setFilter] = useState<'all' | PayoutType>('all')

  const settlements = useSettlements(orgId ?? '', filter === 'all' ? {} : { payoutType: filter })
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const household = useHousehold(orgId ?? '')
  const myMemberId = household.data?.me.memberId

  const settle = useSettleSettlement(orgId ?? '')
  const forgive = useForgiveSettlement(orgId ?? '')
  const create = useCreateSettlement(orgId ?? '')

  const memberName = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of membersQuery.data ?? []) map.set(m.memberId, m.displayName)
    return map
  }, [membersQuery.data])

  // Settle flow (money → method picker; non-money → confirm-fulfill).
  const [settleRow, setSettleRow] = useState<SettlementRow | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const isAdmin = can('editHouseholdSettings')
  // Mirror the Worker: parents file in family; any peer files where there's no gamification hierarchy.
  const canCreate = isAdmin || (features ? !features.gamification : false)
  const showDeepLinks = features?.paymentHandles ?? false

  const onSettleMoney = (row: SettlementRow, method: SettledVia) => {
    // For a deep-link method, open the payment app first (best-effort), then record the settlement.
    if (showDeepLinks && (method === 'venmo' || method === 'paypal' || method === 'cashapp')) {
      const link = paymentDeepLink(
        method,
        memberName.get(row.toMemberId) ?? '',
        row.amountCents ?? 0,
        row.description,
      )
      if (link.url) Linking.openURL(link.url).catch(() => {})
    }
    runSettle(row, method)
  }

  const runSettle = (row: SettlementRow, via: SettledVia) => {
    settle.mutate(
      { id: row.id, input: { settledVia: via } },
      {
        onSuccess: () => {
          toast({ title: row.payoutType === 'money' ? 'Marked paid' : 'Marked fulfilled', variant: 'success' })
          setSettleRow(null)
        },
        onError: (e) => toast({ title: "Couldn't update", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const onForgive = (row: SettlementRow) => {
    forgive.mutate(
      { id: row.id },
      {
        onSuccess: () => toast({ title: 'Forgiven', variant: 'success' }),
        onError: (e) => toast({ title: "Couldn't forgive", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  if (isLoading || !ready) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Settle Up' }} />
        <PageWrapper className="items-center justify-center" scroll={false}>
          <Spinner size="large" />
        </PageWrapper>
      </>
    )
  }

  const data = settlements.data

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Settle Up' }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => Promise.all([settlements.refetch(), membersQuery.refetch()])}>
        {canCreate ? (
          <Button label="New settlement" icon={Plus} onPress={() => setCreateOpen(true)} />
        ) : null}

        <BalanceSummary
          rows={data?.balances ?? []}
          memberName={memberName}
          loading={settlements.isLoading}
          showMoney={filter === 'all' || filter === 'money'}
        />

        <View className="gap-4">
          <Tabs tabs={FILTER_TABS} value={filter} onValueChange={(v) => setFilter(v as 'all' | PayoutType)} />

          <Section title="Pending">
            {settlements.isLoading ? (
              <View className="items-center py-8"><Spinner /></View>
            ) : settlements.isError ? (
              <EmptyState icon={Wallet} title="Couldn't load the ledger" description="Pull to refresh and try again." />
            ) : (data?.pending.length ?? 0) === 0 ? (
              <EmptyState icon={Coins} title="All settled up" description="No one owes anyone right now." />
            ) : (
              <View className="gap-3">
                {data!.pending.map((row) => {
                  // The debtor settles; the creditor or a parent/admin forgives (Worker enforces).
                  const iAmDebtor = myMemberId === row.fromMemberId
                  const iAmCreditor = myMemberId === row.toMemberId
                  return (
                    <SettlementCard
                      key={row.id}
                      row={row}
                      color={colors.mutedForeground}
                      onSettle={iAmDebtor ? () => setSettleRow(row) : undefined}
                      onForgive={iAmCreditor || isAdmin ? () => onForgive(row) : undefined}
                      forgiving={forgive.isPending}
                    />
                  )
                })}
              </View>
            )}
          </Section>

          {(data?.settled.length ?? 0) > 0 ? (
            <Section title="History">
              <View className="gap-3">
                {data!.settled.map((row) => (
                  <SettlementCard key={row.id} row={row} color={colors.mutedForeground} settled />
                ))}
              </View>
            </Section>
          ) : null}
        </View>
      </PageWrapper>

      <SettleSheet
        row={settleRow}
        onClose={() => setSettleRow(null)}
        showDeepLinks={showDeepLinks}
        pending={settle.isPending}
        onPickMoney={(method) => settleRow && onSettleMoney(settleRow, method)}
        onFulfill={() => settleRow && runSettle(settleRow, 'in_person')}
      />

      <CreateDialog
        visible={createOpen}
        onClose={() => setCreateOpen(false)}
        members={(membersQuery.data ?? []).map((m) => ({ label: m.displayName, value: m.memberId }))}
        pending={create.isPending}
        onSubmit={(input) =>
          create.mutate(input, {
            onSuccess: () => {
              toast({ title: 'Settlement created', variant: 'success' })
              setCreateOpen(false)
            },
            onError: (e) => toast({ title: "Couldn't create", description: (e as Error).message, variant: 'error' }),
          })
        }
      />
    </>
  )
}

/** Per-pair balance: net money (signed) + non-money counts in each direction. */
function BalanceSummary({
  rows, memberName, loading, showMoney,
}: {
  rows: { memberA: string; memberB: string; netCentsAOwesB: number; nonMoneyAToB: number; nonMoneyBToA: number }[]
  memberName: Map<string, string>
  loading: boolean
  showMoney: boolean
}) {
  const name = (id: string) => memberName.get(id) ?? 'Someone'
  if (loading) return null
  if (rows.length === 0) return null
  return (
    <Section title="Balances">
      <View className="gap-3">
        {rows.map((b, i) => {
          const aOwes = b.netCentsAOwesB > 0
          const debtor = aOwes ? b.memberA : b.memberB
          const creditor = aOwes ? b.memberB : b.memberA
          const owes = Math.abs(b.netCentsAOwesB)
          const nonMoney = b.nonMoneyAToB + b.nonMoneyBToA
          return (
            <Card key={`${b.memberA}-${b.memberB}-${i}`}>
              <CardContent className="gap-2 p-4">
                <View className="flex-row items-center gap-2">
                  <Avatar name={name(debtor)} size={28} />
                  <Text variant="muted">owes</Text>
                  <Avatar name={name(creditor)} size={28} />
                  <View className="flex-1" />
                  {showMoney && owes > 0 ? <Text variant="label">{formatCents(owes)}</Text> : null}
                </View>
                {nonMoney > 0 ? (
                  <Text variant="caption">
                    {b.nonMoneyAToB > 0 ? `${name(b.memberA)} → ${name(b.memberB)}: ${b.nonMoneyAToB}` : ''}
                    {b.nonMoneyAToB > 0 && b.nonMoneyBToA > 0 ? '  ·  ' : ''}
                    {b.nonMoneyBToA > 0 ? `${name(b.memberB)} → ${name(b.memberA)}: ${b.nonMoneyBToA}` : ''}
                    {'  '}non-money
                  </Text>
                ) : null}
              </CardContent>
            </Card>
          )
        })}
      </View>
    </Section>
  )
}

/** One pending/settled row: payout icon, names, amount/description, source badge, actions. */
function SettlementCard({
  row, color, onSettle, onForgive, forgiving, settled,
}: {
  row: SettlementRow
  color: string
  onSettle?: () => void
  onForgive?: () => void
  forgiving?: boolean
  settled?: boolean
}) {
  const Icon = PAYOUT_ICON[row.payoutType as keyof typeof PAYOUT_ICON] ?? Sparkles
  return (
    <Card className={settled ? 'opacity-70' : undefined}>
      <CardContent className="gap-3 p-4">
        <View className="flex-row items-center gap-3">
          <View className="size-9 items-center justify-center rounded-xl bg-accent">
            <Icon color={color} size={18} />
          </View>
          <View className="flex-1">
            <View className="flex-row items-center gap-1.5">
              <Text variant="label" numberOfLines={1} className="flex-shrink">{row.fromMemberName ?? 'Someone'}</Text>
              <ArrowRight color={color} size={13} />
              <Text variant="label" numberOfLines={1} className="flex-shrink">{row.toMemberName ?? 'Someone'}</Text>
            </View>
            <Text variant="muted" numberOfLines={1}>{amountLabel(row)}</Text>
          </View>
          <Badge variant="outline" label={SOURCE_LABEL[row.sourceType] ?? row.sourceType} />
        </View>

        {row.description && row.payoutType !== 'money' ? (
          <Text variant="caption" numberOfLines={2}>{row.description}</Text>
        ) : null}

        {settled ? (
          <Badge variant="success" label={row.status === 'forgiven' ? 'Forgiven' : 'Settled'} />
        ) : onSettle || onForgive ? (
          <View className="flex-row gap-2">
            {onSettle ? (
              <Button
                size="sm"
                className="flex-1"
                label={row.payoutType === 'money' ? 'Mark settled' : 'Mark fulfilled'}
                onPress={onSettle}
              />
            ) : null}
            {onForgive ? (
              <Button size="sm" variant="outline" label="Forgive" loading={forgiving} onPress={onForgive} />
            ) : null}
          </View>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** The settle sheet: money → method picker (+ deep links); non-money → confirm fulfill. */
function SettleSheet({
  row, onClose, showDeepLinks, pending, onPickMoney, onFulfill,
}: {
  row: SettlementRow | null
  onClose: () => void
  showDeepLinks: boolean
  pending: boolean
  onPickMoney: (method: SettledVia) => void
  onFulfill: () => void
}) {
  const isMoney = row?.payoutType === 'money'
  const methods: { value: SettledVia; label: string }[] = isMoney
    ? [...(showDeepLinks ? DEEP_LINK_METHODS : []), ...MANUAL_METHODS]
    : []
  return (
    <ActionSheet visible={row !== null} onClose={onClose} title={isMoney ? 'How was it paid?' : 'Mark fulfilled?'}>
      {row ? (
        isMoney ? (
          <View>
            {methods.map((m) => (
              <ListItem key={m.value} title={m.label} onPress={() => onPickMoney(m.value)} />
            ))}
          </View>
        ) : (
          <View className="gap-3 px-1 pt-1">
            <Text variant="muted">{row.payoutDescription ?? row.description}</Text>
            <Button label="Mark fulfilled" loading={pending} onPress={onFulfill} />
          </View>
        )
      ) : null}
      <Button variant="ghost" label="Cancel" className="mt-1" onPress={onClose} />
    </ActionSheet>
  )
}

type CreateInput = {
  toMemberId: string
  payoutType: PayoutType
  amountCents?: number
  payoutDescription?: string | null
  description: string
}

/** Manual-IOU form: who, type, amount (money) or description, and a note. */
function CreateDialog({
  visible, onClose, members, pending, onSubmit,
}: {
  visible: boolean
  onClose: () => void
  members: { label: string; value: string }[]
  pending: boolean
  onSubmit: (input: CreateInput) => void
}) {
  const { toast } = useToast()
  const [toMemberId, setToMemberId] = useState('')
  const [payoutType, setPayoutType] = useState<PayoutType>('money')
  const [amount, setAmount] = useState('')
  const [payoutDescription, setPayoutDescription] = useState('')
  const [description, setDescription] = useState('')

  const isMoney = payoutType === 'money'

  const submit = () => {
    if (!toMemberId) {
      toast({ title: 'Pick who this is for', variant: 'error' })
      return
    }
    const desc = description.trim() || payoutDescription.trim()
    if (!desc) {
      toast({ title: 'Add a short description', variant: 'error' })
      return
    }
    const cents = Math.round(Number(amount) * 100)
    if (isMoney && (!Number.isFinite(cents) || cents <= 0)) {
      toast({ title: 'Enter an amount', variant: 'error' })
      return
    }
    onSubmit({
      toMemberId,
      payoutType,
      amountCents: isMoney ? cents : undefined,
      payoutDescription: isMoney ? undefined : payoutDescription.trim() || null,
      description: desc,
    })
  }

  return (
    <Dialog visible={visible} onClose={onClose} title="New settlement" description="File an IOU or a promise.">
      <Form onSubmit={submit} className="gap-3">
        <Select label="To" placeholder="Who is owed?" value={toMemberId} onValueChange={setToMemberId} options={members} />
        <Select
          label="Type"
          value={payoutType}
          onValueChange={(v) => setPayoutType(v as PayoutType)}
          options={PAYOUT_OPTIONS}
        />
        {isMoney ? (
          <Input label="Amount" placeholder="0.00" keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
        ) : (
          <Input
            label="What's promised"
            placeholder="Ice cream trip"
            value={payoutDescription}
            onChangeText={setPayoutDescription}
          />
        )}
        <Textarea label="Note" placeholder="Add context (optional)" value={description} onChangeText={setDescription} />
        <View className="mt-1 flex-row justify-end gap-2">
          <Button variant="ghost" label="Cancel" onPress={onClose} />
          <Button label="Create" loading={pending} onPress={submit} />
        </View>
      </Form>
    </Dialog>
  )
}
