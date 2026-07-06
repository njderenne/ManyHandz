import { useState } from 'react'
import { View } from 'react-native'
import { router, Stack } from 'expo-router'
import { FileDown, LogOut, MonitorSmartphone, Printer, UserRound } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'
import { Card, CardContent } from '@/components/ui/card'
import { Avatar } from '@/components/ui/avatar'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/gallery/kit'
import { useToast } from '@/components/ui/toast'
import { useConfirm } from '@/components/ui/confirm'
import { authClient, signOut, useSession } from '@/lib/auth/client'
// Aliased — this screen has a local `signOutEverywhere` handler (revoke OTHER sessions).
import { signOutEverywhere as performSignOut } from '@/lib/auth/sign-out'
import { purgeQueryCache } from '@/lib/query/client'
import { useExportData } from '@/lib/query/hooks/useExport'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'

/**
 * Account — the signed-in user's profile: display name, password, sign out, and the danger zone.
 * Pushed route (Settings → Account). Signed-out visitors get a friendly sign-in prompt instead.
 */

/**
 * "Export my data" — the org data-ownership row (worker/routes/export.ts): the complete JSON
 * document, per-entity CSVs, or a print-ready report. FREE on every plan, forever (the export is
 * never tier-gated — server law); it IS capability-gated server-side (org:export → owner/admin),
 * so a member tapping it gets an honest 403 toast. Hidden entirely when the app turns the
 * feature off. Renders only with an active org — the export is the ORG's archive, not the user's.
 */
function ExportSection() {
  const { toast } = useToast()
  const { data: activeOrg } = authClient.useActiveOrganization()
  const orgId = activeOrg?.id ?? ''
  const { exportJson, exportCsv, exportPrint, exporting } = useExportData(orgId)

  if (!APP_CONFIG.features.export || !orgId) return null

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn()
      toast({ title: t('export.ready'), variant: 'success' })
    } catch (e) {
      toast({
        title: t('export.failed'),
        description: e instanceof Error ? e.message : undefined,
        variant: 'error',
      })
    }
  }

  return (
    <Section title={t('export.title')}>
      <View className="gap-3">
        <Text variant="muted">{t('export.row')}</Text>
        <Button
          variant="outline"
          icon={FileDown}
          label={t('export.json')}
          loading={exporting === 'json'}
          onPress={() => run(exportJson)}
        />
        <Button
          variant="outline"
          icon={FileDown}
          label={t('export.csv')}
          loading={exporting === 'csv'}
          onPress={() => run(exportCsv)}
        />
        <Button
          variant="outline"
          icon={Printer}
          label={t('export.print')}
          loading={exporting === 'print'}
          onPress={() => run(exportPrint)}
        />
      </View>
    </Section>
  )
}

function SignedIn({ user }: { user: { name: string; email: string; image?: string | null } }) {
  const { toast } = useToast()
  const confirm = useConfirm()

  const [name, setName] = useState(user.name)
  const [savingName, setSavingName] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [changingEmail, setChangingEmail] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  const [signingOut, setSigningOut] = useState(false)
  const [revokingOthers, setRevokingOthers] = useState(false)

  const [deletePassword, setDeletePassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed) {
      toast({ title: 'Name cannot be empty', variant: 'error' })
      return
    }
    setSavingName(true)
    try {
      const res = await authClient.updateUser({ name: trimmed })
      if (res.error) {
        toast({
          title: "Couldn't update name",
          description: res.error.message ?? 'Something went wrong.',
          variant: 'error',
        })
      } else {
        toast({ title: 'Name updated', variant: 'success' })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setSavingName(false)
    }
  }

  const changeEmail = async () => {
    const trimmed = newEmail.trim().toLowerCase()
    if (!trimmed || !trimmed.includes('@')) {
      toast({ title: 'Enter a valid email address', variant: 'error' })
      return
    }
    if (trimmed === user.email.toLowerCase()) {
      toast({ title: 'That is already your email', variant: 'error' })
      return
    }
    setChangingEmail(true)
    try {
      // Better-Auth /change-email: depending on server config this either updates immediately or
      // sends a verification/approval email first — so the success copy stays non-committal.
      const res = await authClient.changeEmail({ newEmail: trimmed })
      if (res.error) {
        // Surface the server's reason verbatim (e.g. email taken, verification required, fresh
        // session needed) — never pretend the change went through.
        toast({
          title: "Couldn't change email",
          description: res.error.message ?? 'The server rejected the request.',
          variant: 'error',
        })
      } else {
        setNewEmail('')
        toast({
          title: 'Email change requested',
          description:
            'If verification is enabled, check your inbox and approve the change before it takes effect.',
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
      setChangingEmail(false)
    }
  }

  const changePassword = async () => {
    if (!currentPassword) {
      toast({ title: 'Enter your current password', variant: 'error' })
      return
    }
    if (newPassword.length < 8) {
      toast({ title: 'New password must be at least 8 characters', variant: 'error' })
      return
    }
    setChangingPassword(true)
    try {
      const res = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: false,
      })
      if (res.error) {
        toast({
          title: "Couldn't change password",
          description: res.error.message ?? 'Something went wrong.',
          variant: 'error',
        })
      } else {
        setCurrentPassword('')
        setNewPassword('')
        toast({ title: 'Password changed', variant: 'success' })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setChangingPassword(false)
    }
  }

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      // THE logout — deregisters this device's push token before ending the session.
      await performSignOut()
      router.replace('/')
    } catch {
      toast({
        title: "Couldn't sign out",
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setSigningOut(false)
    }
  }

  const signOutEverywhere = async () => {
    const ok = await confirm({
      title: 'Sign out everywhere?',
      message: 'This signs out every other device and browser. This session stays signed in.',
      confirmLabel: 'Sign out',
      destructive: true,
    })
    if (!ok) return
    setRevokingOthers(true)
    try {
      // Verified against better-auth: revokeOtherSessions revokes all sessions EXCEPT the
      // current one (revokeSessions would kill this one too — wrong UX here).
      const res = await authClient.revokeOtherSessions()
      if (res.error) {
        toast({
          title: "Couldn't sign out other devices",
          description: res.error.message ?? 'The server rejected the request.',
          variant: 'error',
        })
      } else {
        toast({ title: 'Signed out everywhere else', variant: 'success' })
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setRevokingOthers(false)
    }
  }

  const deleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete account?',
      message: 'This permanently deletes your account and all of its data. This cannot be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    })
    if (!ok) return
    setDeleting(true)
    try {
      const res = await authClient.deleteUser(deletePassword ? { password: deletePassword } : {})
      if (res.error) {
        // Surface the server's reason verbatim (e.g. deletion disabled, wrong password,
        // session not fresh) — the chassis never pretends a delete happened.
        toast({
          title: "Couldn't delete account",
          description: res.error.message ?? 'The server rejected the request.',
          variant: 'error',
        })
      } else {
        await signOut().catch(() => {}) // clear the local token; the server already revoked sessions
        await purgeQueryCache() // drop this user's cached data before the next account signs in
        toast({ title: 'Account deleted', variant: 'success' })
        router.replace('/')
      }
    } catch {
      toast({
        title: 'Network error',
        description: 'Check your connection and try again.',
        variant: 'error',
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <View className="flex-row items-center gap-3">
        <Avatar uri={user.image ?? undefined} name={user.name} size={56} />
        <View className="flex-1 gap-0.5">
          <Text variant="h2" numberOfLines={1}>
            {user.name}
          </Text>
          <Text variant="muted" numberOfLines={1}>
            {user.email}
          </Text>
        </View>
      </View>

      <Section title="Profile">
        <Card>
          <CardContent className="gap-3">
            <Form onSubmit={saveName} className="gap-3">
              <Input
                label={t('account.displayNameLabel')}
                placeholder="Your name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
              />
              <Button label="Save name" loading={savingName} onPress={saveName} />
            </Form>
          </CardContent>
        </Card>
      </Section>

      <Section title="Email">
        <Card>
          <CardContent className="gap-3">
            <Form onSubmit={changeEmail} className="gap-3">
              <Input
                label="New email"
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoComplete="email"
                helper={`Currently ${user.email}. Depending on configuration, you may need to verify the change by email.`}
                value={newEmail}
                onChangeText={setNewEmail}
              />
              <Button
                variant="secondary"
                label="Change email"
                loading={changingEmail}
                onPress={changeEmail}
              />
            </Form>
          </CardContent>
        </Card>
      </Section>

      <Section title="Password">
        <Card>
          <CardContent className="gap-3">
            <Form onSubmit={changePassword} className="gap-3">
              <Input
                label={t('account.currentPasswordLabel')}
                placeholder="••••••••"
                secureTextEntry
                value={currentPassword}
                onChangeText={setCurrentPassword}
              />
              <Input
                label={t('auth.newPasswordLabel')}
                placeholder="••••••••"
                secureTextEntry
                helper="At least 8 characters"
                value={newPassword}
                onChangeText={setNewPassword}
              />
              <Button
                variant="secondary"
                label="Change password"
                loading={changingPassword}
                onPress={changePassword}
              />
            </Form>
          </CardContent>
        </Card>
      </Section>

      <Section title="Session">
        <View className="gap-3">
          <Button
            variant="outline"
            icon={LogOut}
            label="Sign out"
            loading={signingOut}
            onPress={handleSignOut}
          />
          <Button
            variant="outline"
            icon={MonitorSmartphone}
            label="Sign out everywhere"
            loading={revokingOthers}
            onPress={signOutEverywhere}
          />
          <Text variant="caption">
            "Sign out everywhere" ends your sessions on all other devices; this one stays signed
            in.
          </Text>
        </View>
      </Section>

      <ExportSection />

      <Section title="Danger zone">
        <Card className="border-destructive/40">
          <CardContent className="gap-3">
            <Text variant="muted">
              Permanently delete your account and everything in it. This cannot be undone.
            </Text>
            <Form onSubmit={deleteAccount} className="gap-3">
              <Input
                label="Confirm with your password"
                placeholder="••••••••"
                secureTextEntry
                helper="Optional if you signed in recently or use a social account."
                value={deletePassword}
                onChangeText={setDeletePassword}
              />
              <Button
                variant="destructive"
                label="Delete account"
                loading={deleting}
                onPress={deleteAccount}
              />
            </Form>
          </CardContent>
        </Card>
      </Section>
    </>
  )
}

export default function AccountScreen() {
  const { data: session, isPending } = useSession()

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Account' }} />
      <PageWrapper className="gap-8 pb-24">
        {isPending ? (
          <View className="items-center py-24">
            <Spinner size="large" />
          </View>
        ) : !session ? (
          <EmptyState
            icon={UserRound}
            title="You're signed out"
            description={`Sign in to manage your ${APP_CONFIG.name} account.`}
            action={<Button label="Sign in" onPress={() => router.push('/login')} />}
          />
        ) : (
          <SignedIn user={session.user} />
        )}
      </PageWrapper>
    </>
  )
}
