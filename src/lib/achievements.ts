import type { LucideIcon } from 'lucide-react-native'
import { Crown, Flame, Footprints, Trophy, UserPlus, Users } from 'lucide-react-native'
import type { TranslationKey } from '@/lib/i18n'

/**
 * Achievement catalog — MINT §5 doctrine: DEFINITIONS LIVE IN CODE; only unlocks are data.
 * The `achievement_unlock` table (schema.ts) stores facts — (org, user, key, when) with a unique
 * index on org+user+key — while everything presentational (title, description, icon, tier) lives
 * here, versioned with the app. The Worker never reads this file: it treats achievement keys as
 * opaque strings (worker/achievements.ts), so renaming copy or re-tiering never touches data.
 *
 * The six starter achievements below ship with EVERY minted app — they map to chassis events
 * (signup, org join, streaks, referral, subscription) that exist regardless of the product.
 *
 * PER-APP EXTENSION — add product achievements by extending the record (the screen and hook pick
 * them up automatically; no schema or Worker change needed):
 *
 *   'green-thumb': {
 *     key: 'green-thumb',                                  // stable DATA key — never rename after
 *     titleKey: 'achievements.greenThumb.title',           //   launch (unlock rows reference it)
 *     descriptionKey: 'achievements.greenThumb.description',
 *     icon: Sprout,
 *     tier: 'silver',
 *   },
 *
 * …then add the two i18n keys to src/lib/i18n/en.ts and call unlockAchievement() from the Worker
 * route where the milestone happens. Removing a definition is safe too: orphaned unlock rows are
 * simply not rendered (the screen iterates the catalog, not the data).
 */

export type AchievementTier = 'bronze' | 'silver' | 'gold'

export type AchievementDefinition = {
  /**
   * Stable data key — exactly what `achievement_unlock.achievementKey` stores. Lowercase
   * kebab-case by convention. NEVER rename after launch: unlock rows reference it forever.
   */
  key: string
  /** i18n key for the short display name. */
  titleKey: TranslationKey
  /** i18n key for the one-line "how to earn it" description (shown on locked cards too). */
  descriptionKey: TranslationKey
  icon: LucideIcon
  /** Prestige band — drives the badge styling on app/achievements.tsx. */
  tier: AchievementTier
}

/** The full catalog, keyed by achievement key. Insertion order = display order on the screen. */
export const ACHIEVEMENTS: Record<string, AchievementDefinition> = {
  /** Signed up — unlocked from the signup flow. */
  'first-steps': {
    key: 'first-steps',
    titleKey: 'achievements.firstSteps.title',
    descriptionKey: 'achievements.firstSteps.description',
    icon: Footprints,
    tier: 'bronze',
  },
  /** Joined an organization (accepted an invite / became a member beyond the personal org). */
  'team-player': {
    key: 'team-player',
    titleKey: 'achievements.teamPlayer.title',
    descriptionKey: 'achievements.teamPlayer.description',
    icon: Users,
    tier: 'bronze',
  },
  /** Kept a streak (any kind) alive for 7 consecutive days. */
  'streak-7': {
    key: 'streak-7',
    titleKey: 'achievements.streak7.title',
    descriptionKey: 'achievements.streak7.description',
    icon: Flame,
    tier: 'silver',
  },
  /** Kept a streak (any kind) alive for 30 consecutive days. */
  'streak-30': {
    key: 'streak-30',
    titleKey: 'achievements.streak30.title',
    descriptionKey: 'achievements.streak30.description',
    icon: Trophy,
    tier: 'gold',
  },
  /** First successful referral (referred user signed up). */
  referrer: {
    key: 'referrer',
    titleKey: 'achievements.referrer.title',
    descriptionKey: 'achievements.referrer.description',
    icon: UserPlus,
    tier: 'silver',
  },
  /** Subscribed to a paid plan. */
  supporter: {
    key: 'supporter',
    titleKey: 'achievements.supporter.title',
    descriptionKey: 'achievements.supporter.description',
    icon: Crown,
    tier: 'gold',
  },
}

/** The catalog as an ordered list — what grids/iterators consume. */
export const ACHIEVEMENT_LIST: AchievementDefinition[] = Object.values(ACHIEVEMENTS)
