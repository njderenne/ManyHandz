import { useCallback, useEffect, useState } from 'react'
import { View } from 'react-native'
import { SheetModal } from '@/components/ui/sheet'
import { Dialog } from '@/components/ui/dialog'
import { RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { useToast } from '@/components/ui/toast'
import {
  REPORT_REASONS,
  useBlocks,
  useReport,
  type ReportReason,
} from '@/lib/query/hooks/useModeration'
import { t, type TranslationKey } from '@/lib/i18n'

/**
 * Report + Block UI — the composable UGC-safety pieces every content surface mounts
 * (App Store Guideline 1.2 requires both wherever user-generated content appears):
 *
 *   <ReportSheet>   — bottom sheet with a reason picker + optional details; one per screen,
 *                     opened from a row's "…" menu with the target entity's type/id.
 *   useBlockUser()  — confirm-dialog flow ("Block {name}?"); call `confirmBlock(userId, name)`
 *                     from the menu, render the returned `blockDialog` once in the screen.
 *
 * Pairs with worker/routes/moderation.ts and src/lib/query/hooks/useModeration.ts (whose
 * `filterBlocked` is what actually hides a blocked user's rows from lists).
 */

/** Reason value → catalog key, in REPORT_REASONS order (must cover the whole vocabulary). */
const REASON_LABEL_KEYS = {
  spam: 'moderation.reasonSpam',
  harassment: 'moderation.reasonHarassment',
  inappropriate: 'moderation.reasonInappropriate',
  other: 'moderation.reasonOther',
} as const satisfies Record<ReportReason, TranslationKey>

export type ReportSheetProps = {
  visible: boolean
  onClose: () => void
  orgId: string
  /** What kind of entity is being reported (e.g. 'post', 'comment'). */
  entityType: string
  entityId: string
  /** Optional content author, so the report also lands against the user (profile reports). */
  reportedUserId?: string
}

/**
 * Report sheet — reason picker, optional details, submit. SheetModal (not ActionSheet) because
 * the details Textarea needs keyboard handling. State resets every time the sheet opens, so one
 * instance serves every row on a screen — re-point it via props before showing.
 */
export function ReportSheet({
  visible,
  onClose,
  orgId,
  entityType,
  entityId,
  reportedUserId,
}: ReportSheetProps) {
  const { toast } = useToast()
  const report = useReport()
  const [reason, setReason] = useState<ReportReason>()
  const [details, setDetails] = useState('')

  // Fresh form per open — the previous report's reason/details never leak into the next one.
  useEffect(() => {
    if (visible) {
      setReason(undefined)
      setDetails('')
    }
  }, [visible])

  const submit = () => {
    if (!reason) return
    report.mutate(
      { orgId, entityType, entityId, reportedUserId, reason, details: details.trim() || undefined },
      {
        onSuccess: () => {
          toast({ title: t('moderation.reportThanks'), variant: 'success' })
          onClose()
        },
        onError: () => toast({ title: t('moderation.reportFailed'), variant: 'error' }),
      },
    )
  }

  return (
    <SheetModal visible={visible} onClose={onClose} title={t('moderation.reportTitle')} snapPoints={[0.62, 0.9]}>
      <View className="gap-4">
        <RadioGroup
          value={reason}
          onValueChange={(v) => setReason(v as ReportReason)}
          options={REPORT_REASONS.map((r) => ({ value: r, label: t(REASON_LABEL_KEYS[r]) }))}
        />
        <Textarea
          label={t('moderation.detailsLabel')}
          placeholder={t('moderation.detailsPlaceholder')}
          value={details}
          onChangeText={setDetails}
          rows={3}
          maxLength={2000}
        />
        <View className="flex-row justify-end gap-3">
          <Button variant="outline" label={t('common.cancel')} onPress={onClose} />
          <Button
            label={t('moderation.submitReport')}
            onPress={submit}
            disabled={!reason}
            loading={report.isPending}
          />
        </View>
      </View>
    </SheetModal>
  )
}

/**
 * Block-a-user confirm flow. Returns:
 *
 *   confirmBlock(userId, name) — open the confirmation dialog for a user
 *   blockDialog                — render once near the screen root (it's the Dialog element)
 *
 * Confirming awaits the block write (useBlocks): success toasts and closes the dialog; failure
 * toasts and keeps it open for a retry. Combined with `filterBlocked`, the blocked user's
 * content disappears from lists once the cache re-syncs.
 *
 * @example
 * const { confirmBlock, blockDialog } = useBlockUser(orgId)
 * // in a row menu: onPress={() => confirmBlock(post.userId, post.authorName)}
 * // in the screen JSX: {blockDialog}
 */
export function useBlockUser(orgId?: string) {
  const { toast } = useToast()
  const { block } = useBlocks(orgId)
  const [target, setTarget] = useState<{ userId: string; name: string } | null>(null)
  const [blocking, setBlocking] = useState(false)

  const confirmBlock = useCallback((userId: string, name: string) => {
    setTarget({ userId, name })
  }, [])

  const close = () => setTarget(null)
  const confirm = async () => {
    if (!target || blocking) return
    setBlocking(true)
    try {
      await block(target.userId)
      toast({ title: t('moderation.blockSuccess', { name: target.name }), variant: 'success' })
      close()
    } catch {
      // Dialog stays open so the user can retry or cancel.
      toast({ title: t('moderation.blockFailed', { name: target.name }), variant: 'error' })
    } finally {
      setBlocking(false)
    }
  }

  const blockDialog = (
    <Dialog
      visible={Boolean(target)}
      onClose={close}
      title={t('moderation.blockTitle', { name: target?.name ?? '' })}
      description={t('moderation.blockDescription')}
    >
      <View className="flex-row justify-end gap-3">
        <Button variant="outline" label={t('common.cancel')} onPress={close} />
        <Button
          variant="destructive"
          label={t('moderation.blockConfirm')}
          loading={blocking}
          onPress={confirm}
        />
      </View>
    </Dialog>
  )

  return { confirmBlock, blockDialog }
}
