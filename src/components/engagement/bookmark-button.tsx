import { Pressable } from 'react-native'
import { Bookmark, BookmarkCheck } from 'lucide-react-native'
import { cn } from '@/lib/utils'
import { useColors } from '@/lib/config/theme'
import { haptics } from '@/lib/native/haptics'
import { t } from '@/lib/i18n'
import { useBookmarks, useToggleBookmark } from '@/lib/query/hooks/useBookmarks'

/**
 * BookmarkButton — the drop-in save toggle for headers, cards, and list rows. Self-wires to
 * useBookmarks/useToggleBookmark, so callers pass only the entity's identity — no state plumbing:
 *
 *   <BookmarkButton orgId={activeOrg?.id ?? ''} entityType="recipe" entityId={recipe.id} />
 *
 * That's the WHOLE integration for making an entity saveable (the Worker route is polymorphic —
 * see worker/routes/bookmarks.ts). Fill state is optimistic: the icon flips on tap and rolls back
 * if the write fails. Every mounted button for the same entity flips together — they all derive
 * from one cached list per kind. The matching "Saved" screen reads the same hook:
 *
 *   const { bookmarks } = useBookmarks(orgId)          // newest first
 *   // resolve each row's entityId against the domain query; skip rows whose entity is gone
 *
 * Pass `kind` when the app has more than one save flavor ('pin', 'watchlist'); omit for the
 * 'favorite' default. The empty-string orgId (signed out / no active org) just renders a disabled
 * button, so callers can mount it unconditionally.
 */
export type BookmarkButtonProps = {
  /** Active org — pass `activeOrg?.id ?? ''`; the empty string disables the button. */
  orgId: string
  /** The saveable entity's family slug (e.g. 'recipe', 'listing'). */
  entityType: string
  entityId: string
  /** Save namespace — omit for the 'favorite' default. */
  kind?: string
  /** Icon size in px — 22 suits list rows; bump to 24 for screen headers. */
  size?: number
  className?: string
}

export function BookmarkButton({
  orgId,
  entityType,
  entityId,
  kind,
  size = 22,
  className,
}: BookmarkButtonProps) {
  const colors = useColors()
  const { isBookmarked, isLoading } = useBookmarks(orgId, { kind })
  const toggle = useToggleBookmark(orgId)

  const bookmarked = isBookmarked(entityType, entityId)
  const Icon = bookmarked ? BookmarkCheck : Bookmark

  return (
    <Pressable
      // Disabled until the list is known: toggling blind could PUT over an existing save the user
      // meant to remove. isLoading is only true on the first uncached load, so this never lags.
      disabled={!orgId || isLoading}
      onPress={() => {
        haptics.selection()
        toggle.mutate({ entityType, entityId, kind, bookmarked })
      }}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t(bookmarked ? 'bookmarks.removeA11y' : 'bookmarks.saveA11y')}
      accessibilityState={{ selected: bookmarked }}
      className={cn('active:scale-105 active:opacity-80', className)}
    >
      <Icon
        size={size}
        color={bookmarked ? colors.primary : colors.mutedForeground}
        fill={bookmarked ? colors.primary : 'transparent'}
      />
    </Pressable>
  )
}
