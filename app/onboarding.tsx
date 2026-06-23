import { useState } from 'react'
import { View, ScrollView, Pressable } from 'react-native'
import { router, Stack } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Sparkles, Users, Check } from 'lucide-react-native'
import type { LucideIcon } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { APP_CONFIG } from '@/lib/config/app'
import { useColors } from '@/lib/config/theme'
import { selectableModes, type HouseholdMode } from '@/lib/config/modes'
import { useCreateHousehold, useJoinHousehold } from '@/lib/hooks/useOnboarding'
import { SignedInAs } from '@/components/auth/signed-in-as'
import { useToast } from '@/components/ui/toast'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Form } from '@/components/ui/form'

const MODE_ICON: Record<string, LucideIcon> = { family: Sparkles, roommate: Users }

/**
 * Onboarding — create a household (name + mode picker) or join one by code. The entry point for a
 * signed-in user with no household (useRequireHousehold sends them here). The mode they pick drives
 * the entire app; the reference for how a ManyHandz screen composes UI primitives + a mutation hook.
 */
export default function OnboardingScreen() {
  const colors = useColors()
  const { toast } = useToast()
  const [tab, setTab] = useState<'create' | 'join'>('create')
  const [name, setName] = useState('')
  const [mode, setMode] = useState<Exclude<HouseholdMode, 'office'>>('family')
  const [code, setCode] = useState('')
  const create = useCreateHousehold()
  const join = useJoinHousehold()

  const deviceTz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone
    } catch {
      return undefined
    }
  })()

  const onCreate = () => {
    if (!name.trim()) {
      toast({ title: 'Name your household first', variant: 'error' })
      return
    }
    create.mutate(
      { name, mode, timezone: deviceTz },
      {
        onSuccess: () => router.replace('/'),
        onError: (e) => toast({ title: "Couldn't create household", description: (e as Error).message, variant: 'error' }),
      },
    )
  }

  const onJoin = () => {
    if (code.trim().length < 4) {
      toast({ title: 'Enter your invite code', variant: 'error' })
      return
    }
    join.mutate(code.trim(), {
      onSuccess: () => router.replace('/'),
      onError: (e) => toast({ title: "Couldn't join", description: (e as Error).message, variant: 'error' }),
    })
  }

  return (
    <View className="flex-1 bg-background">
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top', 'bottom']} className="flex-1">
        <ScrollView contentContainerClassName="items-center px-5 py-8" keyboardShouldPersistTaps="handled">
          <View className="w-full max-w-md gap-6">
            <View className="gap-2">
              <View className="size-12 items-center justify-center rounded-2xl" style={{ backgroundColor: colors.brand }}>
                <Text variant="h3" style={{ color: colors.onPrimary }}>{APP_CONFIG.name[0] ?? 'M'}</Text>
              </View>
              <Text variant="h1">Welcome to {APP_CONFIG.name}</Text>
              <Text variant="muted">Create your household, or join one with an invite code.</Text>
            </View>

            {/* Who you're signed in as — so a wrong login is obvious, with a one-tap way out. If you
                expected to already have a household, you may be signed in to the wrong account. */}
            <SignedInAs />

            <View className="flex-row gap-2">
              <Button className="flex-1" variant={tab === 'create' ? 'default' : 'outline'} label="Create" onPress={() => setTab('create')} />
              <Button className="flex-1" variant={tab === 'join' ? 'default' : 'outline'} label="Join" onPress={() => setTab('join')} />
            </View>

            {tab === 'create' ? (
              <Form onSubmit={onCreate} className="gap-4">
                <Input label="Household name" placeholder="The Smiths" value={name} onChangeText={setName} />
                <View className="gap-3">
                  <Text variant="label">How does your household work?</Text>
                  {selectableModes().map((m) => {
                    const Icon = MODE_ICON[m.mode] ?? Sparkles
                    const selected = mode === m.mode
                    return (
                      <Pressable key={m.mode} onPress={() => setMode(m.mode as 'family' | 'roommate')} className="active:opacity-80">
                        <Card className={cn(selected && 'border-brand-500')}>
                          <CardContent className="flex-row items-center gap-3 p-4">
                            <View className="size-10 items-center justify-center rounded-xl bg-brand-500/10">
                              <Icon color={colors.brand} size={22} />
                            </View>
                            <View className="flex-1">
                              <Text variant="label">{m.label}</Text>
                              <Text variant="muted">{m.description}</Text>
                            </View>
                            {selected ? <Check color={colors.brand} size={20} /> : null}
                          </CardContent>
                        </Card>
                      </Pressable>
                    )
                  })}
                </View>
                <Button label="Create household" disabled={create.isPending} onPress={onCreate} />
                <Text variant="caption" className="text-center">14-day free trial · no credit card</Text>
              </Form>
            ) : (
              <Form onSubmit={onJoin} className="gap-4">
                <Input label="Invite code" placeholder="ABCD1234" autoCapitalize="characters" autoCorrect={false} value={code} onChangeText={setCode} />
                <Button label="Join household" disabled={join.isPending} onPress={onJoin} />
                <Text variant="caption" className="text-center">Ask a household member for the 8-character code.</Text>
              </Form>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  )
}
