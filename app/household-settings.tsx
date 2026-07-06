import { useEffect, useState } from 'react'
import { View, Share } from 'react-native'
import { Stack } from 'expo-router'
import { Lock, Sparkles, Users, Check } from 'lucide-react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Section, Row } from '@/components/gallery/kit'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import { Stepper } from '@/components/ui/stepper'
import { Select } from '@/components/ui/select'
import { List, ListItem } from '@/components/ui/list'
import { ActionSheet } from '@/components/ui/action-sheet'
import { EmptyState } from '@/components/ui/empty-state'
import { Spinner } from '@/components/ui/spinner'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/components/ui/toast'
import { useColors } from '@/lib/config/theme'
import { useHouseholdMode } from '@/lib/hooks/useHouseholdMode'
import {
  useHousehold,
  useUpdateHousehold,
  useHouseholdMembers,
  useUpdateMember,
  type HouseholdConfig,
  type HouseholdMember,
  type HouseholdSettingsInput,
} from '@/lib/query/hooks/useHousehold'
import { getModeConfig, type HouseholdRole } from '@/lib/config/modes'

/** Mutation surface for the toggle/slider/stepper rows — every field this screen can write. */
type Draft = Pick<
  HouseholdConfig,
  | 'requirePhotoProof' | 'requireApproval' | 'leaderboardVisible'
  | 'allowKidGifting' | 'allowKidChallenges' | 'allowKidCompetitions' | 'maxKidCompetitionStakes'
  | 'aiVerificationEnabled' | 'aiVerificationProvider' | 'aiAutoApproveThreshold'
  | 'aiAutoRejectThreshold' | 'aiMonthlyCostCapCents'
>

const AI_PROVIDERS = [
  { label: 'OpenAI (GPT-4o)', value: 'openai' },
  { label: 'Anthropic (Claude)', value: 'anthropic' },
  { label: 'Google (Gemini)', value: 'google' },
]

const ROLE_LABEL: Record<HouseholdRole, string> = {
  parent: 'Parent',
  kid: 'Kid',
  roommate: 'Roommate',
  manager: 'Manager',
  colleague: 'Colleague',
}

function draftFrom(h: HouseholdConfig): Draft {
  return {
    requirePhotoProof: h.requirePhotoProof,
    requireApproval: h.requireApproval,
    leaderboardVisible: h.leaderboardVisible,
    allowKidGifting: h.allowKidGifting,
    allowKidChallenges: h.allowKidChallenges,
    allowKidCompetitions: h.allowKidCompetitions,
    maxKidCompetitionStakes: h.maxKidCompetitionStakes,
    aiVerificationEnabled: h.aiVerificationEnabled,
    aiVerificationProvider: h.aiVerificationProvider,
    aiAutoApproveThreshold: h.aiAutoApproveThreshold,
    aiAutoRejectThreshold: h.aiAutoRejectThreshold,
    aiMonthlyCostCapCents: h.aiMonthlyCostCapCents,
  }
}

/** A labelled toggle row on the settings surface. */
function ToggleRow({
  label,
  hint,
  value,
  onValueChange,
}: {
  label: string
  hint?: string
  value: boolean
  onValueChange: (v: boolean) => void
}) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <View className="flex-1 gap-0.5">
        <Text variant="label">{label}</Text>
        {hint ? <Text variant="caption">{hint}</Text> : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} accessibilityLabel={label} />
    </View>
  )
}

/**
 * Household Settings — admin-only control surface (gated on can('org:settings')). Edits the
 * household policy via a local draft + Save (useUpdateHousehold), and manages members inline
 * (role change / remove via useUpdateMember, gated on can('member:set_role')). Every block is
 * config-driven: the family-only kid toggles render only when the mode's role set includes 'kid',
 * and the AI block follows features.aiVerification — never a raw mode/role string.
 */
export default function HouseholdSettingsScreen() {
  const { toast } = useToast()
  const colors = useColors()
  const { orgId, ready, isLoading, config, features, can } = useHouseholdMode()
  const householdQuery = useHousehold(orgId ?? '')
  const membersQuery = useHouseholdMembers(orgId ?? '')
  const updateHousehold = useUpdateHousehold(orgId ?? '')
  const updateMember = useUpdateMember(orgId ?? '')

  const household = householdQuery.data?.household
  const myMemberId = householdQuery.data?.me.memberId

  const [draft, setDraft] = useState<Draft | null>(null)
  const [roleSheetFor, setRoleSheetFor] = useState<HouseholdMember | null>(null)

  // Seed the draft once the household loads (and re-seed if a save invalidates the query).
  useEffect(() => {
    if (household) setDraft(draftFrom(household))
  }, [household])

  const set = <K extends keyof Draft>(key: K, val: Draft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: val } : d))

  // --- Gate: loading, then admin-only ---
  if (isLoading || !ready || householdQuery.isLoading || !household || !draft || !config) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Household Settings' }} />
        <PageWrapper className="items-center justify-center py-24">
          <Spinner size="large" />
        </PageWrapper>
      </>
    )
  }

  const canEdit = can('org:settings')
  if (!canEdit) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Household Settings' }} />
        <PageWrapper className="py-12">
          <EmptyState
            icon={Lock}
            title="Admins only"
            description="Household settings can only be changed by an admin. Ask a parent or admin to update these."
          />
        </PageWrapper>
      </>
    )
  }

  // Config-driven blocks (never branch on raw mode/role strings).
  const showKidBlock = config.roles.includes('kid')
  const showAiBlock = Boolean(features?.aiVerification) && can('ai:configure')
  const canChangeRoles = can('member:set_role')

  const dirty = household ? JSON.stringify(draftFrom(household)) !== JSON.stringify(draft) : false

  const onSave = () => {
    const input: HouseholdSettingsInput = { ...draft }
    updateHousehold.mutate(input, {
      onSuccess: () => toast({ title: 'Settings saved', variant: 'success' }),
      onError: (e) => toast({ title: "Couldn't save", description: (e as Error).message, variant: 'error' }),
    })
  }

  const shareInvite = async () => {
    if (!household.inviteCode) return
    try {
      await Share.share({ message: `Join ${household.name} on ManyHandz with code ${household.inviteCode}` })
    } catch {
      // user dismissed the share sheet — nothing to do
    }
  }

  const changeRole = (member: HouseholdMember, role: HouseholdRole) => {
    setRoleSheetFor(null)
    if (role === member.householdRole) return
    updateMember.mutate(
      { memberId: member.memberId, input: { householdRole: role } },
      {
        onSuccess: () => toast({ title: `Role updated to ${ROLE_LABEL[role]}`, variant: 'success' }),
        onError: (e) => toast({ title: "Couldn't change role", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const removeMember = (member: HouseholdMember) => {
    updateMember.mutate(
      { memberId: member.memberId, input: { isActive: false } },
      {
        onSuccess: () => toast({ title: `${member.displayName} removed`, variant: 'success' }),
        onError: (e) => toast({ title: "Couldn't remove member", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const members = membersQuery.data ?? []
  const dollarsCap = (draft.aiMonthlyCostCapCents / 100).toFixed(2)

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Household Settings' }} />
      <PageWrapper className="gap-8 pb-28">
        {/* Mode badge — read-only identity of how this household runs. */}
        <Section title="Mode">
          <Card>
            <CardContent className="flex-row items-center gap-3">
              <View className="size-10 items-center justify-center rounded-xl bg-brand-500/10">
                <Sparkles color={colors.brand} size={22} />
              </View>
              <View className="flex-1">
                <Text variant="label">{household.name}</Text>
                <Text variant="caption">{getModeConfig(household.mode).description}</Text>
              </View>
              <Badge variant="secondary" label={config.label} />
            </CardContent>
          </Card>
        </Section>

        {/* Core policy toggles — apply to every mode. */}
        <Section title="Policy">
          <Card>
            <CardContent className="gap-4">
              <ToggleRow
                label="Require photo proof"
                hint="Chores ask for a before/after photo by default."
                value={draft.requirePhotoProof}
                onValueChange={(v) => set('requirePhotoProof', v)}
              />
              <Separator />
              <ToggleRow
                label="Require approval"
                hint="Completions wait for an admin to verify before points are awarded."
                value={draft.requireApproval}
                onValueChange={(v) => set('requireApproval', v)}
              />
              <Separator />
              <ToggleRow
                label="Leaderboard visible"
                hint="Show the household ranking to members."
                value={draft.leaderboardVisible}
                onValueChange={(v) => set('leaderboardVisible', v)}
              />
            </CardContent>
          </Card>
        </Section>

        {/* Family-only: kid privilege toggles + competition stakes ceiling. */}
        {showKidBlock ? (
          <Section title="Kids" description="Privileges for kid members.">
            <Card>
              <CardContent className="gap-4">
                <ToggleRow
                  label="Allow gifting points"
                  hint="Kids can gift points to siblings."
                  value={draft.allowKidGifting}
                  onValueChange={(v) => set('allowKidGifting', v)}
                />
                <Separator />
                <ToggleRow
                  label="Allow challenges"
                  hint="Kids can start bonus challenges."
                  value={draft.allowKidChallenges}
                  onValueChange={(v) => set('allowKidChallenges', v)}
                />
                <Separator />
                <ToggleRow
                  label="Allow competitions"
                  hint="Kids can challenge each other head-to-head."
                  value={draft.allowKidCompetitions}
                  onValueChange={(v) => set('allowKidCompetitions', v)}
                />
                {draft.allowKidCompetitions ? (
                  <>
                    <Separator />
                    <Row label="Max competition stakes (points)">
                      <Stepper
                        value={draft.maxKidCompetitionStakes}
                        onValueChange={(v) => set('maxKidCompetitionStakes', v)}
                        min={0}
                        max={500}
                        step={10}
                      />
                    </Row>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </Section>
        ) : null}

        {/* AI verification — gated on the mode feature flag + configureAi permission. */}
        {showAiBlock ? (
          <Section title="AI verification" description="Auto-check completion photos.">
            <Card>
              <CardContent className="gap-4">
                <ToggleRow
                  label="Enable AI verification"
                  hint="Score before/after photos to auto-approve or flag."
                  value={draft.aiVerificationEnabled}
                  onValueChange={(v) => set('aiVerificationEnabled', v)}
                />
                {draft.aiVerificationEnabled ? (
                  <>
                    <Separator />
                    <Select
                      label="Provider"
                      value={draft.aiVerificationProvider}
                      onValueChange={(v) => set('aiVerificationProvider', v)}
                      options={AI_PROVIDERS}
                      placeholder="Choose a provider"
                    />
                    <View className="gap-1.5">
                      <View className="flex-row items-center justify-between">
                        <Text variant="label">Auto-approve at</Text>
                        <Text variant="muted">{draft.aiAutoApproveThreshold}% confidence</Text>
                      </View>
                      <Slider
                        value={draft.aiAutoApproveThreshold}
                        onValueChange={(v) => set('aiAutoApproveThreshold', v)}
                        min={0}
                        max={100}
                        accessibilityLabel="Auto-approve threshold"
                      />
                    </View>
                    <View className="gap-1.5">
                      <View className="flex-row items-center justify-between">
                        <Text variant="label">Auto-reject below</Text>
                        <Text variant="muted">{draft.aiAutoRejectThreshold}% confidence</Text>
                      </View>
                      <Slider
                        value={draft.aiAutoRejectThreshold}
                        onValueChange={(v) => set('aiAutoRejectThreshold', v)}
                        min={0}
                        max={100}
                        accessibilityLabel="Auto-reject threshold"
                      />
                    </View>
                    <Row label={`Monthly cost cap ($${dollarsCap})`}>
                      <Stepper
                        value={draft.aiMonthlyCostCapCents}
                        onValueChange={(v) => set('aiMonthlyCostCapCents', v)}
                        min={0}
                        max={10000}
                        step={500}
                      />
                    </Row>
                  </>
                ) : null}
              </CardContent>
            </Card>
          </Section>
        ) : null}

        {/* Invite code — copy for sharing. */}
        <Section title="Invite code" description="Share this so others can join.">
          <Card>
            <CardContent className="flex-row items-center gap-3">
              <View className="flex-1">
                <Text variant="h3" className="tracking-widest">
                  {household.inviteCode ?? '—'}
                </Text>
              </View>
              <Button
                variant="outline"
                size="sm"
                label="Share"
                onPress={shareInvite}
                disabled={!household.inviteCode}
              />
            </CardContent>
          </Card>
        </Section>

        {/* Member management — role change + remove (changeRoles permission). */}
        <Section title="Members" description="Manage who's in your household.">
          {membersQuery.isLoading ? (
            <View className="items-center py-6">
              <Spinner />
            </View>
          ) : members.length === 0 ? (
            <EmptyState icon={Users} title="No members yet" description="Invite people with the code above." />
          ) : (
            <List>
              {members.map((m) => (
                <ListItem
                  key={m.memberId}
                  title={m.displayName + (m.memberId === myMemberId ? ' (you)' : '')}
                  subtitle={ROLE_LABEL[m.householdRole]}
                  left={<Avatar uri={m.avatarUrl ?? undefined} name={m.displayName} size={36} />}
                  right={
                    canChangeRoles && m.memberId !== myMemberId ? (
                      <View className="flex-row items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          label="Role"
                          onPress={() => setRoleSheetFor(m)}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          label="Remove"
                          onPress={() => removeMember(m)}
                          disabled={updateMember.isPending}
                        />
                      </View>
                    ) : (
                      <Badge
                        variant="outline"
                        label={m.householdRole === config.creatorRole ? 'Admin' : ROLE_LABEL[m.householdRole]}
                      />
                    )
                  }
                />
              ))}
            </List>
          )}
        </Section>

        <Button
          label="Save changes"
          onPress={onSave}
          loading={updateHousehold.isPending}
          disabled={!dirty || updateHousehold.isPending}
        />
      </PageWrapper>

      {/* Role picker — options come from the mode config, not a hardcoded list. */}
      <ActionSheet
        visible={roleSheetFor !== null}
        onClose={() => setRoleSheetFor(null)}
        title={roleSheetFor ? `Role for ${roleSheetFor.displayName}` : 'Change role'}
      >
        {config.roles.map((role) => (
          <ListItem
            key={role}
            title={ROLE_LABEL[role]}
            right={
              roleSheetFor?.householdRole === role ? (
                <Check color={colors.primary} size={18} />
              ) : undefined
            }
            onPress={() => roleSheetFor && changeRole(roleSheetFor, role)}
          />
        ))}
        <Button variant="ghost" label="Cancel" className="mt-1" onPress={() => setRoleSheetFor(null)} />
      </ActionSheet>
    </>
  )
}
