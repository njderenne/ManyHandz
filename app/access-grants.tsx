import { useState } from 'react'
import { View, Pressable, Platform, Share } from 'react-native'
import { router, Stack } from 'expo-router'
import { Ban, Copy, KeyRound, Trash2 } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTimePicker } from '@/components/ui/date-time-picker'
import { Dialog } from '@/components/ui/dialog'
import { TierGate } from '@/components/ui/tier-gate'
import { EmptyState } from '@/components/ui/empty-state'
import { AsyncBoundary } from '@/components/ui/async-boundary'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import { SubjectPicker } from '@/components/ui/subject-picker'
import { QRCode } from '@/components/native/qr-code'
import { useColors } from '@/lib/config/theme'
import { authClient, useSession } from '@/lib/auth/client'
import { useActiveOrgGuard } from '@/lib/auth/use-active-org-guard'
import { isUpgradeError } from '@/lib/billing'
import { FEATURE_TIERS } from '@/lib/config/entitlements'
import {
  useGrants,
  useCreateGrant,
  useRevokeGrant,
  useDeleteGrant,
  useGrantActivity,
  type GrantDto,
} from '@/lib/query/hooks/useGrants'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Access grants — the owner-side management screen for the share-grant layer (SUBJECT_SPEC §6.7):
 * mint / list / revoke / delete named, scoped, time-boxed outsider access, and read each grant's
 * audit trail. The grantee's PUBLIC page is app/grant/[code].tsx (no account, the code is the
 * credential).
 *
 * MINTING is the paid half (server: 402 envelope; here: TierGate decorates the mint form only).
 * The list + revoke + delete stay OUTSIDE the gate on purpose — a lapsed org must always be able
 * to see and kill outstanding access (the wind-down asymmetry law, worker/routes/grants.ts).
 */

/**
 * Scope options this screen offers at mint time. MUST stay in lockstep with GRANT_SCOPES in
 * worker/grant-config.ts (the server rejects scopes outside its vocabulary) — the worker file is
 * not importable here (it pulls the DB driver into the client bundle), so the pairing is a
 * convention, like env.ts. Labels are the screen's (i18n) — the wire values are the contract.
 */
const SCOPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'view:subjects', label: t('grants.scopeViewSubjects') },
]

/** Public grant link for a code — the web app is served from the API origin (RN Web). */
function grantLink(code: string): string {
  const base =
    Platform.OS === 'web' && typeof window !== 'undefined'
      ? window.location.origin
      : (process.env.EXPO_PUBLIC_API_URL ?? APP_CONFIG.url)
  return `${base}/grant/${code}`
}

function tomorrowEvening(): Date {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  d.setHours(23, 59, 0, 0)
  return d
}

function isLive(g: GrantDto): boolean {
  const now = Date.now()
  return (
    !g.revokedAt &&
    new Date(g.startsAt).getTime() <= now &&
    new Date(g.expiresAt).getTime() > now
  )
}

/** "2d 3h" / "5h 12m" / "8m" remaining until `to`. */
function remaining(to: string): string {
  const ms = new Date(to).getTime() - Date.now()
  if (ms <= 0) return '0m'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m % 60}m`
}

/** Expandable per-grant audit trail ("who looked, when" — includes 'view' rows). */
function GrantActivity({ orgId, grantId }: { orgId: string; grantId: string }) {
  const activity = useGrantActivity(orgId, grantId)
  return (
    <AsyncBoundary query={activity} isEmpty={(activity.data?.length ?? 0) === 0} loading={<Spinner />} empty={<Text variant="muted">{t('grants.activityEmpty')}</Text>}>
      <View className="gap-1">
        {(activity.data ?? []).map((a) => (
          <View key={a.id} className="flex-row justify-between gap-2 rounded-lg bg-muted px-3 py-2">
            <Text variant="caption">{a.action}</Text>
            <Text variant="caption">{new Date(a.createdAt).toLocaleString()}</Text>
          </View>
        ))}
      </View>
    </AsyncBoundary>
  )
}

function GrantsScreen({ orgId }: { orgId: string }) {
  const { toast } = useToast()
  const confirm = useConfirm()
  const colors = useColors()

  const grants = useGrants(orgId)
  const createGrant = useCreateGrant(orgId)
  const revokeGrant = useRevokeGrant(orgId)
  const deleteGrant = useDeleteGrant(orgId)

  // Mint form
  const [name, setName] = useState('')
  const [nameError, setNameError] = useState<string | undefined>(undefined)
  const [email, setEmail] = useState('')
  const [scopes, setScopes] = useState<string[]>(SCOPE_OPTIONS.map((s) => s.value))
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [startsAt, setStartsAt] = useState<Date>(() => new Date())
  const [expiresAt, setExpiresAt] = useState<Date>(tomorrowEvening)
  // The mint handoff moment — the dialog shows the fresh code + QR exactly once, front and center.
  const [minted, setMinted] = useState<GrantDto | null>(null)
  const [activityFor, setActivityFor] = useState<string | null>(null)

  const toggleScope = (value: string) =>
    setScopes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]))

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed) return setNameError(t('grants.errorNameRequired'))
    if (scopes.length === 0) return toast({ title: t('grants.errorScopeRequired'), variant: 'error' })
    if (expiresAt.getTime() <= startsAt.getTime()) {
      return toast({ title: t('grants.errorDates'), variant: 'error' })
    }
    createGrant.mutate(
      {
        granteeName: trimmed,
        granteeEmail: email.trim() || null,
        scopes,
        subjectId,
        startsAt: startsAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      },
      {
        onSuccess: (g) => {
          setMinted(g)
          setName('')
          setEmail('')
          setSubjectId(null)
        },
        onError: (e) => {
          // A lapsed FREE org hits the server's 402 envelope — route it to the paywall.
          const code = isUpgradeError(e)
          if (code) {
            toast({
              title: e.message,
              variant: 'error',
              action: { label: t('billing.upgradeAction'), onPress: () => router.push(`/paywall?reason=${code}`) },
            })
          } else {
            toast({ title: t('grants.createFailed'), variant: 'error' })
          }
        },
      },
    )
  }

  const copy = async (code: string) => {
    const url = grantLink(code)
    try {
      if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(url)
        toast({ title: t('grants.linkCopied'), variant: 'success' })
      } else {
        await Share.share({ message: url })
      }
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  }

  const revoke = async (g: GrantDto) => {
    const ok = await confirm({
      title: t('grants.revoke'),
      message: t('grants.revokeConfirm', { name: g.granteeName }),
      confirmLabel: t('grants.revoke'),
      destructive: true,
    })
    if (!ok) return
    revokeGrant.mutate(g.id, {
      onSuccess: () => toast({ title: t('grants.revoked'), variant: 'success' }),
      onError: () => toast({ title: t('grants.revokeFailed'), variant: 'error' }),
    })
  }

  const remove = async (g: GrantDto) => {
    const ok = await confirm({
      title: t('grants.delete'),
      message: t('grants.deleteConfirm', { name: g.granteeName }),
      confirmLabel: t('grants.delete'),
      destructive: true,
    })
    if (!ok) return
    deleteGrant.mutate(g.id, {
      onSuccess: () => toast({ title: t('grants.deleted'), variant: 'success' }),
      onError: () => toast({ title: t('grants.deleteFailed'), variant: 'error' }),
    })
  }

  const rows = grants.data ?? []
  const active = rows.filter(isLive)
  const past = rows.filter((g) => !isLive(g))

  return (
    <>
      <Text variant="muted">{t('grants.subtitle')}</Text>

      {/* Mint — the PAID half. TierGate decorates; the server 402 is the real gate. */}
      <TierGate min={FEATURE_TIERS.shareGrants}>
        <Card>
          <CardContent className="gap-4">
            <Text variant="label" className="text-muted-foreground">
              {t('grants.mint')}
            </Text>
            <Input
              label={t('grants.granteeName')}
              placeholder={t('grants.granteeNamePlaceholder')}
              value={name}
              onChangeText={(x) => {
                setName(x)
                if (nameError) setNameError(undefined)
              }}
              error={nameError}
              maxLength={80}
            />
            <Input
              label={t('grants.granteeEmail')}
              placeholder="guest@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              maxLength={120}
            />
            <View className="gap-2">
              <Text variant="label">{t('grants.scopes')}</Text>
              {SCOPE_OPTIONS.map((opt) => (
                <Pressable
                  key={opt.value}
                  onPress={() => toggleScope(opt.value)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: scopes.includes(opt.value) }}
                  className="min-h-[40px] flex-row items-center gap-2 active:opacity-70"
                >
                  <Checkbox
                    checked={scopes.includes(opt.value)}
                    onCheckedChange={() => toggleScope(opt.value)}
                  />
                  <Text variant="body">{opt.label}</Text>
                </Pressable>
              ))}
            </View>
            {/* Optional subject pin — SubjectPicker renders null when features.subjects is off. */}
            {APP_CONFIG.features.subjects ? (
              <SubjectPicker
                orgId={orgId}
                label={t('grants.subjectPin')}
                value={subjectId}
                onChange={setSubjectId}
                allowNone
                noneLabel={t('grants.subjectPinNone')}
              />
            ) : null}
            <DateTimePicker
              label={t('grants.starts')}
              mode="datetime"
              value={startsAt}
              onValueChange={setStartsAt}
            />
            <DateTimePicker
              label={t('grants.expires')}
              mode="datetime"
              value={expiresAt}
              onValueChange={setExpiresAt}
              minimumDate={startsAt}
            />
            <Button label={t('grants.mint')} loading={createGrant.isPending} onPress={submit} />
          </CardContent>
        </Card>
      </TierGate>

      {/* List + wind-down — DELIBERATELY outside the TierGate (revoke works at FREE forever). */}
      <AsyncBoundary
        query={grants}
        loading={<Spinner />}
        isEmpty={rows.length === 0}
        empty={<EmptyState icon={KeyRound} title={t('grants.emptyTitle')} description={t('grants.emptyBody')} />}
      >
        <Text variant="label">{t('grants.activeTitle')}</Text>
        {active.length === 0 ? (
          <Text variant="muted">{t('grants.activeEmpty')}</Text>
        ) : (
          active.map((g) => (
            <Card key={g.id}>
              <CardContent className="gap-2">
                <View className="flex-row items-center justify-between gap-2">
                  <Text variant="label">{g.granteeName}</Text>
                  <Text variant="caption">{t('grants.expiresIn', { time: remaining(g.expiresAt) })}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <Text variant="caption" className="font-mono">
                    {g.code}
                  </Text>
                  <Pressable
                    onPress={() => copy(g.code)}
                    accessibilityRole="button"
                    accessibilityLabel={t('grants.copyCode')}
                    className="min-h-[40px] flex-row items-center gap-1 active:opacity-70"
                  >
                    {/* Explicit theme color — a bare lucide icon defaults to currentColor, which
                        resolves to black in RN and vanishes on the dark theme. */}
                    <Copy size={14} color={colors.primary} />
                    <Text variant="caption" className="text-primary">
                      {t('grants.copyCode')}
                    </Text>
                  </Pressable>
                </View>
                <View className="flex-row flex-wrap gap-1">
                  {g.scopes.map((s) => (
                    <View key={s} className="rounded-full bg-accent px-2 py-0.5">
                      <Text variant="caption">
                        {SCOPE_OPTIONS.find((o) => o.value === s)?.label ?? s}
                      </Text>
                    </View>
                  ))}
                </View>
                <View className="flex-row gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    icon={Ban}
                    label={t('grants.revoke')}
                    onPress={() => revoke(g)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    label={t('grants.activity')}
                    onPress={() => setActivityFor(activityFor === g.id ? null : g.id)}
                  />
                </View>
                {activityFor === g.id ? <GrantActivity orgId={orgId} grantId={g.id} /> : null}
              </CardContent>
            </Card>
          ))
        )}

        {past.length > 0 ? (
          <>
            <Text variant="label" className="mt-2">
              {t('grants.pastTitle')}
            </Text>
            {past.map((g) => (
              <Card key={g.id}>
                <CardContent className="gap-2">
                  <View className="flex-row items-center justify-between gap-2">
                    <View className="flex-1">
                      <Text variant="label">{g.granteeName}</Text>
                      <Text variant="caption">
                        {g.revokedAt
                          ? t('grants.revokedOn', { date: new Date(g.revokedAt).toLocaleDateString() })
                          : t('grants.expiredOn', { date: new Date(g.expiresAt).toLocaleDateString() })}
                      </Text>
                    </View>
                    <View className="flex-row gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        label={t('grants.activity')}
                        onPress={() => setActivityFor(activityFor === g.id ? null : g.id)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        label={t('grants.delete')}
                        onPress={() => remove(g)}
                      />
                    </View>
                  </View>
                  {activityFor === g.id ? <GrantActivity orgId={orgId} grantId={g.id} /> : null}
                </CardContent>
              </Card>
            ))}
          </>
        ) : null}
      </AsyncBoundary>

      {/* The handoff moment: fresh code + link + QR, shown right after the mint. */}
      <Dialog
        visible={Boolean(minted)}
        onClose={() => setMinted(null)}
        title={t('grants.mintedTitle')}
        description={t('grants.codeShownOnce', { name: minted?.granteeName ?? '' })}
      >
        <View className="items-center gap-3 pt-1">
          <Text variant="h2" className="font-mono tracking-widest">
            {minted?.code ?? ''}
          </Text>
          {minted ? <QRCode value={grantLink(minted.code)} /> : null}
          <View className="flex-row justify-end gap-3 self-stretch pt-1">
            <Button variant="outline" label={t('grants.close')} onPress={() => setMinted(null)} />
            <Button
              icon={Copy}
              label={t('grants.copyCode')}
              onPress={() => minted && copy(minted.code)}
            />
          </View>
        </View>
      </Dialog>
    </>
  )
}

export default function AccessGrantsScreen() {
  useActiveOrgGuard()
  const { data: session, isPending } = useSession()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''

  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: true, title: t('grants.title') }} />
      <PageWrapper className="gap-5 pb-16">
        {!APP_CONFIG.features.shareGrants ? (
          <EmptyState icon={KeyRound} title={t('grants.offTitle')} description={t('grants.offBody')} />
        ) : isPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={KeyRound}
            title={t('grants.signedOutTitle')}
            description={t('grants.signedOutBody')}
            action={<Button label={t('auth.signIn')} onPress={() => router.push('/login')} />}
          />
        ) : orgId ? (
          <GrantsScreen orgId={orgId} />
        ) : (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        )}
      </PageWrapper>
    </View>
  )
}
