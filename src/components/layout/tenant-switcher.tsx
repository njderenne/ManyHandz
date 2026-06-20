import { useState } from 'react'
import { Pressable } from 'react-native'
import { ChevronsUpDown, Check, Plus } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { Text } from '@/components/ui/text'
import { Avatar } from '@/components/ui/avatar'
import { ActionSheet } from '@/components/ui/action-sheet'
import { ListItem } from '@/components/ui/list'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * TenantSwitcher — switch the active organization (display-aliased per app via APP_CONFIG.tenant,
 * e.g. "Household" / "Team"). Backed by Better-Auth's active-org; wire `onSelect` to set it.
 */
export type Tenant = { id: string; name: string }

export function TenantSwitcher({
  tenants,
  activeId,
  onSelect,
  onCreate,
  className,
}: {
  tenants: Tenant[]
  activeId: string
  onSelect: (id: string) => void
  onCreate?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const colors = useColors()
  const active = tenants.find((t) => t.id === activeId) ?? tenants[0]

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
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
        {tenants.map((t) => (
          <ListItem
            key={t.id}
            title={t.name}
            left={<Avatar name={t.name} size={32} />}
            right={t.id === activeId ? <Check color={colors.success} size={18} /> : undefined}
            onPress={() => {
              onSelect(t.id)
              setOpen(false)
            }}
          />
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
