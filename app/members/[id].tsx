import { useMemo, useState } from 'react'
import { View, Linking } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { format } from 'date-fns'
import {
  Users, Gift, Cake, Wallet, Flame, Star, Trophy, Plane, ArrowRight, Pencil, Check,
} from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Select } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Stepper } from '@/components/ui/stepper'
import { Dialog } from '@/components/ui/dialog'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { List, ListItem } from '@/components/ui/list'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { accentHex, MEMBER_ACCENT_KEYS } from '@/lib/manyhandz/accents'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import { getModeConfig } from '@/lib/config/modes'
import { useHousehold, useHouseholdMembers, useUpdateMember, type HouseholdMember } from '@/lib/query/hooks/useHousehold'
import { useSendGift, type GiftType } from '@/lib/query/hooks/useGifts'
import { useSettlements, paymentDeepLink, type PaymentMethod } from '@/lib/query/hooks/useSettlements'
import { useActivityFeed } from '@/lib/query/hooks/useActivity'
import { formatCurrency } from '@/lib/format/currency'

/**
 * Member profile (`/members/[id]`) — the rich per-member page: accent-ringed avatar, role, level/XP
 * (gamified modes), bio, age, the Settle-Up balance vs the viewer with deep-link Pay buttons, a Gift
 * Points action (gated on can('giftPoints')), recent activity, and the management affordances — an
 * admin (can('changeRoles')) can re-role / mark a member away, and the member themselves can edit
 * their own display name, accent color, bio, birthday, and away mode. Every write is permission-gated
 * by useHouseholdMode().can(); the Worker re-enforces.
 */

const GIFT_TYPES: { label: string; value: GiftType }[] = [
  { label: 'General', value: 'general' },
  { label: 'Thank you', value: 'thank_you' },
  { label: 'Birthday', value: 'birthday' },
  { label: 'Bonus', value: 'bonus' },
]

const ACCENT_OPTIONS = MEMBER_ACCENT_KEYS.map((k) => ({
  label: k.charAt(0).toUpperCase() + k.slice(1),
  value: k,
}))

/** Whole years between a YYYY-MM-DD birthday and today, or null if unset/unparseable. */
function ageFrom(birthday: string | null): number | null {
  if (!birthday) return null
  const dob = new Date(`${birthday}T00:00`)
  if (Number.isNaN(dob.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - dob.getFullYear()
  const m = now.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age -= 1
  return age >= 0 && age < 130 ? age : null
}

function isAway(member: HouseholdMember): boolean {
  if (!member.awayUntil) return false
  return member.awayUntil >= new Date().toISOString().slice(0, 10)
}

/** A compact labeled stat tile for the stats row. */
function Stat({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  const colors = useColors()
  return (
    <Card className="flex-1">
      <CardContent className="items-center gap-1 p-3">
        <Icon color={colors.brand} size={18} />
        <Text variant="label">{value}</Text>
        <Text variant="caption">{label}</Text>
      </CardContent>
    </Card>
  )
}

export default function MemberProfileScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const memberId = typeof id === 'string' ? id : ''
  const { toast } = useToast()
  const colors = useColors()
  const { orgId, ready, isLoading, mode, features, can } = useHouseholdMode()

  const membersQuery = useHouseholdMembers(orgId ?? '')
  const householdQuery = useHousehold(orgId ?? '')
  const settlements = useSettlements(orgId ?? '')
  const activity = useActivityFeed(orgId ?? '')

  const sendGift = useSendGift(orgId ?? '')
  const updateMember = useUpdateMember(orgId ?? '')

  const member = membersQuery.data?.find((m) => m.memberId === memberId)
  const myMemberId = householdQuery.data?.me.memberId
  const isSelf = Boolean(member && myMemberId === member.memberId)
  const gamified = features?.gamification ?? false

  // Pair balance vs the viewer — positive cents = I owe THIS member; negative = they owe me.
  const pairBalance = useMemo(() => {
    if (!member || !myMemberId) return null
    const row = settlements.data?.balances.find(
      (b) =>
        (b.memberA === myMemberId && b.memberB === member.memberId) ||
        (b.memberA === member.memberId && b.memberB === myMemberId),
    )
    if (!row) return null
    // Normalize so a positive number always means "I owe THIS member".
    const iOweThem = row.memberA === myMemberId ? row.netCentsAOwesB : -row.netCentsAOwesB
    return { iOweThemCents: iOweThem }
  }, [settlements.data, member, myMemberId])

  // This member's recent activity (their userId authored the entry).
  const recent = useMemo(
    () => (activity.data ?? []).filter((e) => e.userId && e.userId === member?.userId).slice(0, 6),
    [activity.data, member?.userId],
  )

  // --- Gift dialog ---
  const [giftOpen, setGiftOpen] = useState(false)
  const [giftPoints, setGiftPoints] = useState(10)
  const [giftType, setGiftType] = useState<GiftType>('general')
  const [giftNote, setGiftNote] = useState('')

  const submitGift = () => {
    if (!member) return
    sendGift.mutate(
      { toMemberId: member.memberId, points: giftPoints, note: giftNote.trim() || null, giftType },
      {
        onSuccess: () => {
          toast({ title: `Sent ${giftPoints} points`, variant: 'success' })
          setGiftOpen(false)
          setGiftNote('')
          setGiftPoints(10)
        },
        onError: (e) => toast({ title: "Couldn't send gift", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  // --- Edit dialog (self) / admin role + away ---
  const [editOpen, setEditOpen] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [bio, setBio] = useState('')
  const [color, setColor] = useState('coral')
  const [birthday, setBirthday] = useState<Date | undefined>(undefined)
  const [awayOn, setAwayOn] = useState(false)
  const [awayReason, setAwayReason] = useState('')

  const openEdit = () => {
    if (!member) return
    setDisplayName(member.displayName)
    setBio(member.bio ?? '')
    setColor(member.favoriteColor)
    setBirthday(member.birthday ? new Date(`${member.birthday}T00:00`) : undefined)
    setAwayOn(isAway(member))
    setAwayReason(member.awayReason ?? '')
    setEditOpen(true)
  }

  const saveEdit = () => {
    if (!member) return
    const name = displayName.trim()
    if (!name) {
      toast({ title: 'Enter a display name', variant: 'error' })
      return
    }
    updateMember.mutate(
      {
        memberId: member.memberId,
        input: {
          displayName: name,
          bio: bio.trim() || null,
          favoriteColor: color,
          birthday: birthday ? format(birthday, 'yyyy-MM-dd') : null,
          awayUntil: awayOn ? (member.awayUntil ?? new Date().toISOString().slice(0, 10)) : null,
          awayReason: awayOn ? awayReason.trim() || null : null,
        },
      },
      {
        onSuccess: () => {
          toast({ title: 'Profile updated', variant: 'success' })
          setEditOpen(false)
        },
        onError: (e) => toast({ title: "Couldn't save", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const changeRole = (role: string) => {
    if (!member) return
    updateMember.mutate(
      { memberId: member.memberId, input: { householdRole: role as HouseholdMember['householdRole'] } },
      {
        onSuccess: () => toast({ title: 'Role updated', variant: 'success' }),
        onError: (e) => toast({ title: "Couldn't change role", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const toggleAway = (on: boolean) => {
    if (!member) return
    updateMember.mutate(
      {
        memberId: member.memberId,
        input: {
          awayUntil: on ? (member.awayUntil ?? new Date().toISOString().slice(0, 10)) : null,
          awayReason: on ? member.awayReason : null,
        },
      },
      {
        onSuccess: () => toast({ title: on ? 'Marked away' : 'Marked back', variant: 'success' }),
        onError: (e) => toast({ title: "Couldn't update", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  // Open a payment app for a money balance the viewer owes this member (mirrors settle-up.tsx).
  const payVia = (method: PaymentMethod, cents: number) => {
    if (!member) return
    const link = paymentDeepLink(method, member.displayName, cents, 'Settle up')
    if (link.url) Linking.openURL(link.url).catch(() => {})
    else router.push('/settle-up')
  }

  const showDeepLinks = features?.paymentHandles ?? false
  const roleOptions = mode
    ? getModeConfig(mode).roles.map((r) => ({ label: r.charAt(0).toUpperCase() + r.slice(1), value: r }))
    : []

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Profile' }} />
      <PageWrapper className="gap-6 pb-24" onRefresh={() => Promise.all([membersQuery.refetch(), settlements.refetch()])}>
        {(!ready && isLoading) || membersQuery.isLoading ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !member ? (
          <EmptyState
            icon={Users}
            title="Member not found"
            description="This member may have left the household."
            action={
              <Button
                variant="outline"
                label="Back to members"
                onPress={() => (router.canGoBack() ? router.back() : router.replace('/members'))}
              />
            }
          />
        ) : (
          <>
            {/* Identity */}
            <View className="items-center gap-3">
              <View className="rounded-full p-1" style={{ borderWidth: 3, borderColor: accentHex(member.favoriteColor) }}>
                <Avatar uri={member.avatarUrl ?? undefined} name={member.displayName} size={96} />
              </View>
              <Text variant="h2" className="text-center">
                {member.displayName}
              </Text>
              <View className="flex-row flex-wrap items-center justify-center gap-2">
                <Badge
                  variant={member.householdRole === 'parent' || member.householdRole === 'manager' ? 'default' : 'secondary'}
                  label={member.householdRole.charAt(0).toUpperCase() + member.householdRole.slice(1)}
                />
                {gamified ? <Badge variant="outline" label={`Lv ${member.level} · ${member.title}`} /> : null}
                {isAway(member) ? <Badge variant="warning" label="Away" /> : null}
              </View>
              {member.bio ? (
                <Text variant="muted" className="max-w-sm text-center">
                  {member.bio}
                </Text>
              ) : null}
              {isSelf ? (
                <Button variant="outline" size="sm" icon={Pencil} label="Edit profile" onPress={openEdit} />
              ) : null}
            </View>

            {/* About */}
            <Card>
              <CardContent className="gap-3">
                {ageFrom(member.birthday) !== null ? (
                  <View className="flex-row items-center gap-3">
                    <Cake color={colors.mutedForeground} size={18} />
                    <Text variant="body">{ageFrom(member.birthday)} years old</Text>
                  </View>
                ) : null}
                {member.birthday ? (
                  <View className="flex-row items-center gap-3">
                    <Cake color={colors.mutedForeground} size={18} />
                    <Text variant="body">Birthday {format(new Date(`${member.birthday}T00:00`), 'MMM d')}</Text>
                  </View>
                ) : null}
                {isAway(member) && member.awayReason ? (
                  <View className="flex-row items-center gap-3">
                    <Plane color={colors.mutedForeground} size={18} />
                    <Text variant="body">Away — {member.awayReason}</Text>
                  </View>
                ) : null}
                {!member.birthday && !isAway(member) ? (
                  <Text variant="muted">No profile details yet.</Text>
                ) : null}
              </CardContent>
            </Card>

            {/* Stats */}
            {gamified ? (
              <View className="flex-row gap-3">
                <Stat icon={Star} label="Points" value={String(member.pointsBalance)} />
                <Stat icon={Trophy} label="Level" value={String(member.level)} />
                <Stat icon={Flame} label="Streak" value={`${member.currentStreak}d`} />
              </View>
            ) : (
              <View className="flex-row gap-3">
                <Stat icon={Star} label="Points" value={String(member.pointsBalance)} />
                <Stat icon={Flame} label="Streak" value={`${member.currentStreak}d`} />
                <Stat icon={Trophy} label="Best" value={`${member.longestStreak}d`} />
              </View>
            )}

            {/* Gift points — gated on giftPoints (kid toggle handled by can()); not on self. */}
            {!isSelf && features?.pointGifting && can('giftPoints') ? (
              <Button icon={Gift} label="Gift points" onPress={() => setGiftOpen(true)} />
            ) : null}

            {/* Settle up balance vs the viewer */}
            {!isSelf && features?.paymentHandles ? (
              <Card>
                <CardContent className="gap-3">
                  <View className="flex-row items-center gap-2">
                    <Wallet color={colors.brand} size={18} />
                    <Text variant="label">Settle up</Text>
                  </View>
                  {pairBalance && pairBalance.iOweThemCents !== 0 ? (
                    <>
                      <Text variant="body">
                        {pairBalance.iOweThemCents > 0
                          ? `You owe ${member.displayName} ${formatCurrency(pairBalance.iOweThemCents / 100)}`
                          : `${member.displayName} owes you ${formatCurrency(Math.abs(pairBalance.iOweThemCents) / 100)}`}
                      </Text>
                      {showDeepLinks && pairBalance.iOweThemCents > 0 ? (
                        <View className="flex-row flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            label="Venmo"
                            onPress={() => payVia('venmo', pairBalance.iOweThemCents)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            label="PayPal"
                            onPress={() => payVia('paypal', pairBalance.iOweThemCents)}
                          />
                          <Button
                            size="sm"
                            variant="outline"
                            label="Cash App"
                            onPress={() => payVia('cashapp', pairBalance.iOweThemCents)}
                          />
                        </View>
                      ) : null}
                    </>
                  ) : (
                    <Text variant="muted">All square — nothing to settle.</Text>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={ArrowRight}
                    label="Open Settle Up"
                    onPress={() => router.push('/settle-up')}
                    className="self-start"
                  />
                </CardContent>
              </Card>
            ) : null}

            {/* Admin actions */}
            {!isSelf && can('changeRoles') ? (
              <Card>
                <CardContent className="gap-4">
                  <Text variant="label">Manage member</Text>
                  <Select
                    label="Role"
                    value={member.householdRole}
                    onValueChange={changeRole}
                    options={roleOptions}
                  />
                  <View className="flex-row items-center justify-between gap-3">
                    <View className="flex-1">
                      <Text variant="label">Away</Text>
                      <Text variant="caption">Skips rotation and excludes them from fairness.</Text>
                    </View>
                    <Switch value={isAway(member)} onValueChange={toggleAway} accessibilityLabel="Away" />
                  </View>
                </CardContent>
              </Card>
            ) : null}

            {/* Recent activity */}
            <View className="gap-2">
              <Text variant="label">Recent activity</Text>
              {activity.isLoading ? (
                <View className="items-center py-6">
                  <Spinner />
                </View>
              ) : recent.length === 0 ? (
                <EmptyState icon={Users} title="Nothing yet" description="Their recent actions will show up here." />
              ) : (
                <List>
                  {recent.map((e) => (
                    <ListItem
                      key={e.id}
                      title={`${e.action} ${e.entityType}`.replace(/_/g, ' ')}
                      subtitle={format(new Date(e.createdAt), 'MMM d · h:mm a')}
                    />
                  ))}
                </List>
              )}
            </View>
          </>
        )}
      </PageWrapper>

      {/* Gift points dialog */}
      <Dialog
        visible={giftOpen}
        onClose={() => setGiftOpen(false)}
        title={`Gift points to ${member?.displayName ?? ''}`}
        description="Move points from your balance to theirs."
      >
        <View className="gap-3 pt-1">
          <View className="flex-row items-center justify-between gap-3">
            <Text variant="label">Points</Text>
            <Stepper value={giftPoints} onValueChange={setGiftPoints} min={1} max={500} step={5} />
          </View>
          <Select
            label="Type"
            value={giftType}
            onValueChange={(v) => setGiftType(v as GiftType)}
            options={GIFT_TYPES}
          />
          <Textarea
            label="Note"
            placeholder="Add a message (optional)"
            rows={2}
            value={giftNote}
            onChangeText={setGiftNote}
            maxLength={200}
          />
          <View className="flex-row justify-end gap-3 pt-1">
            <Button variant="outline" label="Cancel" onPress={() => setGiftOpen(false)} />
            <Button label="Send gift" loading={sendGift.isPending} onPress={submitGift} />
          </View>
        </View>
      </Dialog>

      {/* Self-edit dialog */}
      <Dialog visible={editOpen} onClose={() => setEditOpen(false)} title="Edit your profile">
        <View className="gap-3 pt-1">
          <Input label="Display name" value={displayName} onChangeText={setDisplayName} maxLength={60} />
          <Select label="Favorite color" value={color} onValueChange={setColor} options={ACCENT_OPTIONS} />
          <Textarea label="Bio" placeholder="Tell your household about yourself" rows={3} value={bio} onChangeText={setBio} maxLength={200} />
          <DateTimePicker label="Birthday" mode="date" value={birthday} onValueChange={setBirthday} maximumDate={new Date()} />
          <View className="flex-row items-center justify-between gap-3">
            <View className="flex-1">
              <Text variant="label">Away mode</Text>
              <Text variant="caption">Pause new chores while you're out.</Text>
            </View>
            <Switch value={awayOn} onValueChange={setAwayOn} accessibilityLabel="Away mode" />
          </View>
          {awayOn ? (
            <Input label="Reason" placeholder="Vacation, travel…" value={awayReason} onChangeText={setAwayReason} maxLength={120} />
          ) : null}
          <View className="flex-row justify-end gap-3 pt-1">
            <Button variant="outline" label="Cancel" onPress={() => setEditOpen(false)} />
            <Button label="Save" icon={Check} loading={updateMember.isPending} onPress={saveEdit} />
          </View>
        </View>
      </Dialog>
    </>
  )
}
