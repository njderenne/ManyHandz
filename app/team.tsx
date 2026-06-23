import { useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { Check, Mail, Users } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { List, ListItem } from '@/components/ui/list'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { authClient, organization, useSession } from '@/lib/auth/client'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Team — manage the Better-Auth organization (display-aliased per app via APP_CONFIG.tenant):
 * switch the active one, create a new one, see members, and invite people (the Worker emails the
 * invite via Resend). Pushed route (Settings → Team); signed-out visitors get a sign-in prompt.
 */

const TENANT = APP_CONFIG.tenant.singular.toLowerCase()
const TENANTS = APP_CONFIG.tenant.plural.toLowerCase()

/** "Acme Inc." → "acme-inc" — the org slug is derived from the name, never typed by hand. */
function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function roleBadge(role: string) {
  const variant = role.includes('owner') ? 'default' : role.includes('admin') ? 'secondary' : 'outline'
  return <Badge variant={variant} label={role} />
}

function SignedIn() {
  const { toast } = useToast()
  const colors = useColors()
  const { data: orgs, isPending: orgsPending } = authClient.useListOrganizations()
  const { data: activeOrg, isPending: activePending } = authClient.useActiveOrganization()

  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member')
  const [inviting, setInviting] = useState(false)

  const switchOrg = async (id: string) => {
    if (id === activeOrg?.id || switchingId) return
    setSwitchingId(id)
    try {
      const res = await organization.setActive({ organizationId: id })
      if (res.error) {
        toast({
          title: `Couldn't switch ${TENANT}`,
          description: res.error.message ?? 'Something went wrong.',
          variant: 'error',
        })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setSwitchingId(null)
    }
  }

  const createOrg = async () => {
    const name = createName.trim()
    const slug = slugify(name)
    if (!name || !slug) {
      toast({ title: `Enter a ${TENANT} name`, variant: 'error' })
      return
    }
    setCreating(true)
    try {
      const res = await organization.create({ name, slug })
      if (res.error || !res.data) {
        toast({
          title: `Couldn't create ${TENANT}`,
          description: res.error?.message ?? 'Something went wrong.',
          variant: 'error',
        })
      } else {
        setCreateName('')
        // Make the new org active right away; if this hiccups, tapping it in the list also works.
        await organization.setActive({ organizationId: res.data.id }).catch(() => {})
        toast({ title: `${APP_CONFIG.tenant.singular} created`, variant: 'success' })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setCreating(false)
    }
  }

  const invite = async () => {
    const email = inviteEmail.trim().toLowerCase()
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      // Reuses the canonical validation copy from the auth screens so the wording can't drift.
      toast({ title: t('auth.errorInvalidEmail'), variant: 'error' })
      return
    }
    setInviting(true)
    try {
      const res = await organization.inviteMember({ email, role: inviteRole })
      if (res.error) {
        toast({
          title: "Couldn't send invite",
          description: res.error.message ?? 'Something went wrong.',
          variant: 'error',
        })
      } else {
        setInviteEmail('')
        toast({
          title: 'Invite sent',
          description: `${email} was invited as ${inviteRole}.`,
          variant: 'success',
        })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setInviting(false)
    }
  }

  const pendingInvites = activeOrg?.invitations.filter((i) => i.status === 'pending') ?? []

  return (
    <>
      <Section title={APP_CONFIG.tenant.plural} description="Tap one to make it active.">
        {orgsPending ? (
          <View className="items-center py-6">
            <Spinner />
          </View>
        ) : !orgs || orgs.length === 0 ? (
          <EmptyState
            icon={Users}
            title={`No ${TENANTS} yet`}
            description={`Create your first ${TENANT} below to invite people and share data.`}
          />
        ) : (
          <List>
            {orgs.map((org) => (
              <ListItem
                key={org.id}
                title={org.name}
                subtitle={org.slug}
                left={<Avatar name={org.name} size={32} />}
                right={
                  switchingId === org.id ? (
                    <Spinner />
                  ) : org.id === activeOrg?.id ? (
                    <Check color={colors.success} size={18} />
                  ) : undefined
                }
                onPress={() => switchOrg(org.id)}
              />
            ))}
          </List>
        )}
      </Section>

      <Section title={`New ${TENANT}`}>
        <Card>
          <CardContent className="gap-3">
            <Form onSubmit={createOrg} className="gap-3">
              <Input
                label="Name"
                placeholder="Acme Inc"
                value={createName}
                onChangeText={setCreateName}
                autoCapitalize="words"
                helper={createName.trim() ? `Slug: ${slugify(createName)}` : undefined}
              />
              <Button
                label={`Create ${TENANT}`}
                loading={creating}
                disabled={!slugify(createName)}
                onPress={createOrg}
              />
            </Form>
          </CardContent>
        </Card>
      </Section>

      {activePending && !activeOrg ? (
        <View className="items-center py-6">
          <Spinner />
        </View>
      ) : activeOrg ? (
        <>
          <Section title="Members" description={`People in ${activeOrg.name}`}>
            <List>
              {activeOrg.members.map((member) => (
                <ListItem
                  key={member.id}
                  title={member.user.name || member.user.email}
                  subtitle={member.user.email}
                  left={<Avatar uri={member.user.image} name={member.user.name} size={36} />}
                  right={roleBadge(String(member.role))}
                />
              ))}
            </List>
            {pendingInvites.length > 0 ? (
              <View className="gap-2">
                <Text variant="caption">Pending invites</Text>
                <List>
                  {pendingInvites.map((inv) => (
                    <ListItem
                      key={inv.id}
                      title={inv.email}
                      subtitle={`Invited as ${String(inv.role)}`}
                      left={<Mail color={colors.mutedForeground} size={18} />}
                      right={<Badge variant="outline" label="pending" />}
                    />
                  ))}
                </List>
              </View>
            ) : null}
          </Section>

          <Section title="Invite member" description="They'll receive an email invitation.">
            <Card>
              <CardContent className="gap-3">
                <Form onSubmit={invite} className="gap-3">
                  <Input
                    label="Email"
                    placeholder="teammate@example.com"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={inviteEmail}
                    onChangeText={setInviteEmail}
                  />
                  <View className="gap-1.5">
                    <Text variant="label">Role</Text>
                    <SegmentedControl
                      value={inviteRole}
                      onValueChange={(v) => setInviteRole(v as 'member' | 'admin')}
                      options={[
                        { label: 'Member', value: 'member' },
                        { label: 'Admin', value: 'admin' },
                      ]}
                    />
                  </View>
                  <Button label="Send invite" loading={inviting} onPress={invite} />
                </Form>
              </CardContent>
            </Card>
          </Section>
        </>
      ) : orgs && orgs.length > 0 ? (
        <Text variant="muted" className="text-center">
          Select a {TENANT} above to manage its members.
        </Text>
      ) : null}
    </>
  )
}

export default function TeamScreen() {
  const { data: session, isPending } = useSession()

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: APP_CONFIG.tenant.plural }} />
      <PageWrapper className="gap-8 pb-24">
        {isPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={Users}
            title="You're signed out"
            description={`Sign in to manage your ${TENANTS} and invite people.`}
            action={<Button label="Sign in" onPress={() => router.push('/login')} />}
          />
        ) : (
          <SignedIn />
        )}
      </PageWrapper>
    </>
  )
}
