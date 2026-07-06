import { useState } from 'react'
import { View } from 'react-native'
import { Stack, router, useLocalSearchParams } from 'expo-router'
import { MailOpen } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import { useToast } from '@/components/ui/toast'
import { useSession, organization } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'

/**
 * Accept invite — the landing page for organization-invitation emails
 * (`${BETTER_AUTH_URL}/accept-invite/<invitationId>`). Opens in the browser (web build) or the app
 * via deep link. Signed-out visitors are sent to sign in/up first — the invite must be accepted by
 * an account matching the invited email, so they re-open the link after.
 */
export default function AcceptInviteScreen() {
  const colors = useColors()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data: session, isPending } = useSession()
  const { toast } = useToast()
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null)

  const act = async (kind: 'accept' | 'decline') => {
    if (!id) return
    setBusy(kind)
    try {
      if (kind === 'accept') {
        const res = await organization.acceptInvitation({ invitationId: id })
        if (res.error) {
          // Already-accepted tolerance: a server-side safety net (e.g. an email-match auto-accept on
          // session create) may have claimed this exact invite before the user tapped, so re-accepting
          // now throws INVITATION_NOT_FOUND. That's not a failure — the user DID join. Confirm by
          // resolving membership and, if they're in an org, treat it as success instead of surfacing a
          // spurious error toast. Genuine errors (YOU_ARE_NOT_THE_RECIPIENT, MEMBERSHIP_LIMIT_REACHED)
          // still surface below.
          const code = res.error.code ?? ''
          const message = res.error.message ?? ''
          const looksAlreadyAccepted =
            code.includes('INVITATION_NOT_FOUND') || /not found/i.test(message)
          if (looksAlreadyAccepted) {
            const orgs = await organization.list().catch(() => null)
            const joinedOrgId = orgs?.data?.[0]?.id
            if (joinedOrgId) {
              await organization.setActive({ organizationId: joinedOrgId }).catch(() => {})
              toast({ title: `Welcome to the ${APP_CONFIG.tenant.singular.toLowerCase()}!`, variant: 'success' })
              router.replace('/team')
              return
            }
          }
          throw new Error(res.error.message)
        }
        // Land the user IN the org they just joined; if this hiccups, tapping it in the list works.
        const orgId = res.data?.invitation?.organizationId
        if (orgId) await organization.setActive({ organizationId: orgId }).catch(() => {})
        toast({ title: `Welcome to the ${APP_CONFIG.tenant.singular.toLowerCase()}!`, variant: 'success' })
        router.replace('/team')
      } else {
        const res = await organization.rejectInvitation({ invitationId: id })
        if (res.error) throw new Error(res.error.message)
        toast({ title: 'Invitation declined' })
        router.replace('/')
      }
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : 'Could not process the invitation',
        variant: 'error',
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <PageWrapper className="gap-6 pb-24">
      <Stack.Screen options={{ headerShown: true, title: 'Invitation' }} />
      <View className="items-center gap-2 pt-8">
        <View className="size-14 items-center justify-center rounded-xl bg-muted">
          <MailOpen color={colors.brand} size={28} />
        </View>
        <Text variant="h2">You're invited</Text>
        <Text variant="muted" className="text-center">
          You've been invited to join a {APP_CONFIG.tenant.singular.toLowerCase()} on {APP_CONFIG.name}.
        </Text>
      </View>

      {isPending ? (
        <View className="items-center py-8">
          <Spinner />
        </View>
      ) : session ? (
        <Card>
          <CardContent className="gap-3">
            <Text variant="muted">
              Signed in as <Text variant="label">{session.user.email}</Text> — the invitation must
              match this email.
            </Text>
            <Button label="Accept invitation" loading={busy === 'accept'} disabled={busy !== null} onPress={() => act('accept')} />
            <Button
              variant="outline"
              label="Decline"
              loading={busy === 'decline'}
              disabled={busy !== null}
              onPress={() => act('decline')}
            />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="gap-3">
            <Text variant="muted">
              Sign in (or create an account) with the email this invite was sent to, then open the
              invitation link again.
            </Text>
            <Button label="Sign in" onPress={() => router.push('/login')} />
            <Button variant="outline" label="Create account" onPress={() => router.push('/signup')} />
          </CardContent>
        </Card>
      )}
    </PageWrapper>
  )
}
