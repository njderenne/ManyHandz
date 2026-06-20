/**
 * Mode-aware navigation tabs (CLIENT-ONLY — imports icon components, so the Worker must NOT import
 * this; it imports the pure `modes.ts` instead). The product nav reads `navTabsFor(mode, role)` to
 * render the right tab set; hrefs must match real routes in app/ once built.
 */
import type { LucideIcon } from 'lucide-react-native'
import { Home, CalendarDays, Scale, Gift, Target, Settings, BarChart3 } from 'lucide-react-native'
import type { HouseholdMode, HouseholdRole } from './modes'

export type ModeNavTab = {
  name: string
  label: string
  href: string
  icon: LucideIcon
  aliases?: string[]
}

const t = (name: string, label: string, href: string, icon: LucideIcon, aliases?: string[]): ModeNavTab => ({
  name, label, href, icon, ...(aliases ? { aliases } : {}),
})

const HOME = t('home', 'Home', '/', Home, ['/assignments', '/chores'])
const SCHEDULE = t('schedule', 'Schedule', '/schedule', CalendarDays)
const FAIRNESS = t('fairness', 'Fairness', '/fairness', Scale)
const REWARDS = t('rewards', 'Rewards', '/rewards', Gift)
const GOALS = t('goals', 'Goals', '/goals', Target)
const STATS = t('stats', 'My Stats', '/fairness', BarChart3) // kid "My Stats" maps to the fairness screen
const SETTINGS = t('settings', 'Settings', '/settings', Settings)

/** Per-mode, per-role tab sets (brief: Design System → bottom nav). */
export const MODE_NAV_TABS: Record<HouseholdMode, Record<string, ModeNavTab[]>> = {
  family: {
    parent: [HOME, SCHEDULE, FAIRNESS, REWARDS, SETTINGS],
    kid: [HOME, GOALS, REWARDS, STATS],
  },
  roommate: {
    roommate: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
  },
  office: {
    manager: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
    colleague: [HOME, SCHEDULE, FAIRNESS, SETTINGS],
  },
}

export function navTabsFor(mode: HouseholdMode, role: HouseholdRole): ModeNavTab[] {
  return MODE_NAV_TABS[mode]?.[role] ?? []
}
