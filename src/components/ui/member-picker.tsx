import { useMemo } from 'react'
import { Select } from './select'
import { useHouseholdMembers } from '@/lib/query/hooks/useHousehold'

/**
 * MemberPicker — pick a household member (or several) to assign work to. The vendored ManyHandz
 * copy of the chassis "assign a person" control (template: src/components/ui/member-picker.tsx),
 * sourced from useHouseholdMembers and assigning by **member.id** (org-scoped; survives the
 * account-less members ManyHandz supports). Drop it onto any flow that hands a chore to someone:
 * the chore Assign action, rotation member-ordering, etc.
 *
 *   Single:  <MemberPicker orgId={orgId} value={memberId} onChange={setMemberId} />
 *   Multi:   <MemberPicker orgId={orgId} multiple values={ids} onValuesChange={setIds} />
 */
export type MemberPickerProps = {
  orgId: string
  label?: string
  placeholder?: string
  value?: string | null
  onChange?: (memberId: string | null) => void
  multiple?: boolean
  values?: string[]
  onValuesChange?: (memberIds: string[]) => void
  disabled?: boolean
  className?: string
}

export function MemberPicker({
  orgId,
  label,
  placeholder = 'Choose a member…',
  value,
  onChange,
  multiple = false,
  values = [],
  onValuesChange,
  disabled,
  className,
}: MemberPickerProps) {
  const { data, isLoading } = useHouseholdMembers(orgId)

  const options = useMemo(
    () => (data ?? []).map((m) => ({ label: m.displayName, value: m.memberId })),
    [data],
  )
  // Searchable once the household is large enough that scanning gets tedious (mirrors Select).
  const searchable = options.length > 8

  if (multiple) {
    return (
      <Select
        className={className}
        label={label}
        placeholder={placeholder}
        multiple
        searchable={searchable}
        disabled={disabled || isLoading}
        options={options}
        values={values}
        onValuesChange={onValuesChange}
      />
    )
  }

  return (
    <Select
      className={className}
      label={label}
      placeholder={placeholder}
      searchable={searchable}
      disabled={disabled || isLoading}
      options={options}
      value={value ?? undefined}
      onValueChange={(v) => onChange?.(v)}
    />
  )
}
