import { useMemo } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { APP_CONFIG } from '@/lib/config/app'
import { cn } from '@/lib/utils'
import { useActiveSubject, useSubjects } from '@/lib/query/hooks/useSubjects'
import { Select } from './select'
import { Avatar } from './avatar'
import { Text } from './text'

/**
 * SubjectPicker — pick a subject (or several) to attach a record to: "which pet is this feeding
 * for?", "whose dose is this?". THE reusable "about a subject" control, deliberately
 * prop-compatible with MemberPicker so screens swap assignee-of-member for about-a-subject
 * without relearning (same Select recipe, a subject data source, `allowNone` instead of
 * `allowUnassigned`). It reads the active roster (useSubjects → worker/routes/subjects.ts) and
 * selects by **subject.id** — org-scoped, and it survives account-less subjects.
 *
 *   Single:  <SubjectPicker orgId={orgId} value={subjectId} onChange={setSubjectId} allowNone />
 *   Multi:   <SubjectPicker orgId={orgId} multiple values={ids} onValuesChange={setIds} />
 *
 * Labels come from props / APP_CONFIG.subjects.kinds (the screen owns i18n — member-picker
 * convention); the component stays string-agnostic and reusable. Both exports render NOTHING when
 * `APP_CONFIG.features.subjects` is off, so shared screens can compose them unconditionally at
 * zero cost. Web fallback: pure RN primitives — nothing native, nothing to fall back from.
 */
export type SubjectPickerProps = {
  orgId: string
  /** Filter to one configured kind (APP_CONFIG.subjects.kinds). Omit for all kinds. */
  kind?: string
  label?: string
  placeholder?: string
  /** Single-select value (a subject.id), or null when none is chosen. */
  value?: string | null
  onChange?: (subjectId: string | null) => void
  /** Multi-select mode — drive with `values` + `onValuesChange`. */
  multiple?: boolean
  values?: string[]
  onValuesChange?: (subjectIds: string[]) => void
  /** Add a "No one / General" row to the single-select list that clears the value. */
  allowNone?: boolean
  /** Label for the none row (the screen owns the wording). */
  noneLabel?: string
  /** Include archived subjects — rare admin views only (restore pickers, history filters). */
  includeArchived?: boolean
  disabled?: boolean
  className?: string
}

/** Sentinel value for the synthetic "none" option (never a real subject.id). */
const NONE = '__none__'

export function SubjectPicker({
  orgId,
  kind,
  label,
  placeholder = 'Choose…',
  value,
  onChange,
  multiple = false,
  values = [],
  onValuesChange,
  allowNone = false,
  noneLabel = 'None',
  includeArchived = false,
  disabled,
  className,
}: SubjectPickerProps) {
  // Feature-gated module: hooks run unconditionally (rules of hooks), the render self-gates.
  const enabled = APP_CONFIG.features.subjects
  const { data, isLoading } = useSubjects(orgId, { kind, includeArchived })

  const options = useMemo(() => {
    const opts = (data ?? []).map((s) => ({ label: s.displayName, value: s.id }))
    // The none escape hatch only makes sense for single-select (multi clears by deselecting).
    return allowNone && !multiple ? [{ label: noneLabel, value: NONE }, ...opts] : opts
  }, [data, allowNone, multiple, noneLabel])

  if (!enabled) return null

  // Searchable once the list is long enough that scanning gets tedious (mirrors MemberPicker).
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
      onValueChange={(v) => onChange?.(v === NONE ? null : v)}
    />
  )
}

/**
 * SubjectSwitcher — the horizontal avatar-chip header row that picks WHO the screen is showing
 * (the RxMndr active-person switcher / keepsey child-tabs shape), driven by useActiveSubject so
 * the selection persists per org across restarts. Renders nothing when the feature is off OR
 * when there's at most one active subject — a single-subject org has nothing to switch, so the
 * row would be confusing chrome. Avatars are initials-based (the subject roster carries no media
 * mime info; screens that want photos compose MediaImage themselves).
 */
export function SubjectSwitcher({
  orgId,
  kind,
  className,
}: {
  orgId: string
  kind?: string
  className?: string
}) {
  const enabled = APP_CONFIG.features.subjects
  const { subject, subjects, setActiveSubject } = useActiveSubject(orgId, kind)

  if (!enabled || subjects.length <= 1) return null

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className={cn('flex-grow-0', className)}
    >
      <View className="flex-row items-center gap-2 px-1 py-1">
        {subjects.map((s) => {
          const active = s.id === subject?.id
          return (
            <Pressable
              key={s.id}
              onPress={() => setActiveSubject(s.id)}
              accessibilityRole="button"
              accessibilityLabel={s.displayName}
              accessibilityState={{ selected: active }}
              className={cn(
                'min-h-[40px] flex-row items-center gap-2 rounded-full border px-3 py-1.5 active:opacity-70',
                // Selection is marked by border + fill together — never color alone.
                active ? 'border-primary bg-accent' : 'border-border bg-card',
              )}
            >
              <Avatar name={s.displayName} size={24} />
              <Text variant="label" numberOfLines={1} className="max-w-[120px]">
                {s.displayName}
              </Text>
            </Pressable>
          )
        })}
      </View>
    </ScrollView>
  )
}
