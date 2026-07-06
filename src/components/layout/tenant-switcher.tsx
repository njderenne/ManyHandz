import { useState } from 'react'
import { Pressable } from 'react-native'
import { router, type Href } from 'expo-router'
import { ChevronsUpDown, Check, Plus } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'
import { Avatar } from '@/components/ui/avatar'
import { ActionSheet } from '@/components/ui/action-sheet'
import { ListItem } from '@/components/ui/list'
import { APP_CONFIG } from '@/lib/config/app'
import { t } from '@/lib/i18n'
import { KIND_LABELS, ROLE_LABELS, type Kind } from '@/lib/config/roles'
import { useActiveContext, type AvailableContext } from '@/lib/context/use-active-context'
import { useSwitchContext } from '@/lib/context/switch-context'

/**
 * TenantSwitcher — switch the active organization/context (SPINE_SPEC §6.4, grindline's grouped
 * version). Two shapes, one component:
 *
 *  - `tenants` (flat list) — the pre-spine surface, kept byte-compatible: existing call sites
 *    (dev gallery chrome) pass `{ id, name }[]` and render exactly today's flat list.
 *  - `groups` (kind-grouped) — the multi-kind surface: sections per kind (KIND_LABELS headers —
 *    NOT the single APP_CONFIG.tenant alias, which can't name two kinds), each row showing the
 *    caller's per-context role as a subtitle (ROLE_LABELS[kind][role]).
 *
 * Degeneration rule (the prime directive): with ≤1 group there are NO section headers — a
 * single-kind app sees exactly today's flat list. Presentational on purpose (data + callbacks as
 * props) so the dev gallery can drive it; mount the connected <ContextSwitcher/> in the app.
 */
export type Tenant = { id: string; name: string; kind?: string; role?: string }

/** Contexts pre-grouped by kind, in display order — the shape useActiveContext().grouped emits. */
export type TenantGroup = { kind: Kind; contexts: AvailableContext[] }

function roleSubtitle(kind: string | undefined, role: string | undefined): string | undefined {
  if (!kind || !role) return undefined
  // Kind/role come from persisted data — unknown pairs render no subtitle, never crash. BOTH
  // lookups are own-property guarded (W-1): a stale role string like 'toString' must never
  // resolve through the prototype chain into a function rendered as a Text child.
  if (!Object.hasOwn(ROLE_LABELS, kind)) return undefined
  const labels = ROLE_LABELS[kind as Kind]
  return Object.hasOwn(labels, role) ? labels[role] : undefined
}

export function TenantSwitcher({
  tenants,
  groups,
  activeId,
  onSelect,
  onCreate,
  className,
}: {
  /** Flat list (legacy/simple shape). Ignored when `groups` is provided. */
  tenants?: Tenant[]
  /** Kind-grouped contexts — pass useActiveContext().grouped for the multi-kind switcher. */
  groups?: TenantGroup[]
  activeId?: string
  onSelect: (id: string) => void
  onCreate?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const colors = useColors()

  // Normalize both prop shapes onto groups; a flat list is one unlabeled group.
  const resolvedGroups: { kind?: Kind; contexts: Tenant[] }[] = groups ?? [
    { contexts: tenants ?? [] },
  ]
  const all = resolvedGroups.flatMap((g) => g.contexts)
  const active = all.find((x) => x.id === activeId) ?? all[0]
  // Section headers only when there is MORE than one group — the single-kind degeneration rule.
  const showHeaders = resolvedGroups.length > 1

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('context.switch')}
        className={cn(
          'flex-row items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 active:bg-accent',
          className,
        )}
      >
        <Avatar name={active?.name} size={26} />
        <Text variant="label" className="flex-1" numberOfLines={1}>
          {active?.name}
        </Text>
        <ChevronsUpDown color={colors.mutedForeground} size={16} />
      </Pressable>

      <ActionSheet visible={open} onClose={() => setOpen(false)} title={APP_CONFIG.tenant.plural}>
        {resolvedGroups.map((group, i) => (
          <Section
            key={group.kind ?? `flat-${i}`}
            label={
              showHeaders && group.kind && Object.hasOwn(KIND_LABELS, group.kind)
                ? KIND_LABELS[group.kind].plural
                : undefined
            }
          >
            {group.contexts.map((x) => (
              <ListItem
                key={x.id}
                title={x.name}
                subtitle={roleSubtitle(x.kind, x.role)}
                left={<Avatar name={x.name} size={32} />}
                right={x.id === activeId ? <Check color={colors.success} size={18} /> : undefined}
                onPress={() => {
                  onSelect(x.id)
                  setOpen(false)
                }}
              />
            ))}
          </Section>
        ))}
        <ListItem
          title={`New ${APP_CONFIG.tenant.singular.toLowerCase()}`}
          left={<Plus color={colors.mutedForeground} size={20} />}
          onPress={() => {
            onCreate?.()
            setOpen(false)
          }}
        />
      </ActionSheet>
    </>
  )
}

/** A small labeled section inside the sheet — separates the per-kind groups. Label-less when the
 *  switcher degenerates to a flat list (≤1 group), so single-kind renders exactly as before. */
function Section({ label, children }: { label?: string; children: React.ReactNode }) {
  if (!label) return <>{children}</>
  return (
    <>
      <Text variant="caption" className="px-1 pt-2 uppercase tracking-wider">
        {label}
      </Text>
      {children}
    </>
  )
}

/**
 * ContextSwitcher — the connected switcher: reads the available contexts from `useActiveContext`
 * (grouped by kind, personal auto-excluded) and switches via `useSwitchContext` (which purges the
 * cross-tenant cache — SPINE §6.2). Hidden entirely when there are no groups (a solo user whose
 * only org is the personal one has nothing to switch). The "new" row routes to /onboarding —
 * B5's create-or-join chooser, also reachable stand-alone.
 */
export function ContextSwitcher({ className }: { className?: string }) {
  const { grouped, active } = useActiveContext()
  const { switchContext } = useSwitchContext()

  if (grouped.length === 0) return null

  return (
    <TenantSwitcher
      groups={grouped}
      activeId={active?.contextId}
      onSelect={(id) => {
        if (id !== active?.contextId) void switchContext(id)
      }}
      // Path-string contract (B1↔B5): the onboarding screen lands at integration, so the
      // typed-routes union doesn't include it yet — hence the Href cast.
      onCreate={() => router.push('/onboarding' as Href)}
      className={className}
    />
  )
}
