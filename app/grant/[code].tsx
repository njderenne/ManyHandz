import { View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { Lock } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { ApiError } from '@/lib/api/client'
import { usePublicGrant } from '@/lib/query/hooks/useGrants'
import { t } from '@/lib/i18n'

/**
 * Public grant page — what the GRANTEE sees (SUBJECT_SPEC §6.7): the account-less outsider opens
 * /grant/<code> from the link/QR the owner shared. No session anywhere on this path — the code is
 * the whole credential, re-validated server-side per request (worker/routes/grant-public.ts).
 * Web serves it directly ('/grant' is in PUBLIC_PREFIXES — M-2, so a signed-out visitor is NOT
 * auth-redirected); native reaches it via deep link.
 *
 * Status rules: 'invalid' is ONE generic screen — missing, revoked, and mistyped codes look
 * identical (no oracle). not_started/expired show the grantee their window (grant metadata only,
 * zero org data). 'active' renders the app-composed `view` — the template default is the curated
 * subject roster with INITIALS avatars (M-3: media URLs are org-gated and never exposed here).
 *
 * EXTENDING (per app): register actions in worker/grant-config.ts `grantActions`, then add the
 * matching buttons/forms here driven by `useGrantAction(code)` + the grant's `scopes` — the
 * pet-pilot sitter log form is the reference shape. The chassis ships zero actions, so this
 * screen ships read-only.
 */

/** The template default composer's subject shape (worker/grant-config.ts allowlist). */
type PublicSubject = { id: string; kind: string; displayName: string; birthDate: string | null }

/** "2d 3h" / "5h 12m" / "8m" remaining until `to`. */
function remaining(to?: string): string {
  if (!to) return ''
  const ms = new Date(to).getTime() - Date.now()
  if (ms <= 0) return '0m'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m % 60}m`
  return `${m % 60}m`
}

export default function GrantPublicScreen() {
  const { code: codeParam } = useLocalSearchParams<{ code: string }>()
  const code = typeof codeParam === 'string' ? codeParam : ''

  const query = usePublicGrant(code)
  const view = query.data

  // 404s arrive as errors; a 200 body can also carry status:'invalid' — both are the ONE screen.
  const invalid =
    !code ||
    (query.error instanceof ApiError && query.error.status === 404) ||
    view?.status === 'invalid'
  const inactive = view && view.status !== 'active' && !invalid

  const subjects = (view?.view?.subjects as PublicSubject[] | undefined) ?? []

  return (
    <View className="flex-1">
      <Stack.Screen options={{ headerShown: false, title: t('grantPublic.title') }} />
      <PageWrapper className="gap-4 pb-16">
        {query.isLoading ? (
          <View className="items-center gap-3 py-24">
            <Spinner size="large" />
            <Text variant="muted">{t('grantPublic.validating')}</Text>
          </View>
        ) : invalid || (query.isError && !view) ? (
          // ONE generic denial — never says whether the code existed, expired, or was revoked.
          <EmptyState icon={Lock} title={t('grantPublic.invalidTitle')} description={t('grantPublic.invalid')} />
        ) : inactive ? (
          <EmptyState
            icon={Lock}
            title={t('grantPublic.invalidTitle')}
            description={
              view!.status === 'not_started'
                ? t('grantPublic.notStarted', { date: new Date(view!.startsAt ?? '').toLocaleString() })
                : t('grantPublic.expired', { date: new Date(view!.expiresAt ?? '').toLocaleString() })
            }
          />
        ) : view && view.status === 'active' ? (
          <>
            {/* Who + where + how long — the grantee's orientation bar. */}
            <View className="flex-row items-center justify-between gap-2 rounded-xl bg-card p-4">
              <View className="flex-1">
                <Text variant="label">{t('grantPublic.welcome', { name: view.granteeName ?? '' })}</Text>
                {view.orgName ? <Text variant="caption">{view.orgName}</Text> : null}
              </View>
              <Text variant="caption">{t('grantPublic.expiresIn', { time: remaining(view.expiresAt) })}</Text>
            </View>

            {/* The composed view — template default: the curated subject roster. Initials
                avatars only (M-3): media URLs are session+org-gated and never reach this page. */}
            {subjects.length > 0 ? (
              <View className="gap-3">
                {subjects.map((s) => (
                  <Card key={s.id}>
                    <CardContent className="flex-row items-center gap-3">
                      <Avatar name={s.displayName} size={40} />
                      <View className="flex-1 gap-0.5">
                        <Text variant="label">{s.displayName}</Text>
                        <Text variant="caption">
                          {[s.kind, s.birthDate].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                    </CardContent>
                  </Card>
                ))}
              </View>
            ) : (
              <Text variant="muted">{t('grantPublic.emptyView')}</Text>
            )}

            {/* What this grant allows — the scope chips (values are the wire vocabulary). */}
            <View className="rounded-lg bg-card p-3">
              <Text variant="caption" className="text-muted-foreground">
                {t('grantPublic.actions')}
              </Text>
              <View className="mt-1 flex-row flex-wrap gap-1">
                {(view.scopes ?? []).map((s) => (
                  <View key={s} className="rounded-full bg-accent px-2 py-0.5">
                    <Text variant="caption">{s.replace(/[:_]/g, ' ')}</Text>
                  </View>
                ))}
              </View>
            </View>

            <Text variant="caption" className="text-center text-muted-foreground">
              {t('grantPublic.footer')}
            </Text>
          </>
        ) : null}
      </PageWrapper>
    </View>
  )
}
