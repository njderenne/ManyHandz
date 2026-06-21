/**
 * Query-key registry — the single source of truth for TanStack Query keys.
 * Keep keys hierarchical so org-scoped invalidation is a prefix match.
 */
export const queryKeys = {
  health: ['health'] as const,

  session: ['session'] as const,

  /** The caller's user_settings row (notification prefs, marketing consent, locale, timezone). */
  userSettings: ['user', 'settings'] as const,

  organizations: {
    all: ['organizations'] as const,
    detail: (orgId: string) => ['organizations', orgId] as const,
    members: (orgId: string) => ['organizations', orgId, 'members'] as const,
    notifications: (orgId: string) => ['organizations', orgId, 'notifications'] as const,
    activity: (orgId: string) => ['organizations', orgId, 'activity'] as const,
    blocks: (orgId: string) => ['organizations', orgId, 'blocks'] as const,
    /** Engagement commons — credits balance/history, achievement unlocks, streak state. */
    creditBalance: (orgId: string) => ['organizations', orgId, 'credits', 'balance'] as const,
    creditHistory: (orgId: string) => ['organizations', orgId, 'credits', 'history'] as const,
    achievements: (orgId: string) => ['organizations', orgId, 'achievements'] as const,
    streak: (orgId: string, kind: string) => ['organizations', orgId, 'streak', kind] as const,
    /** Archetype commons — AI chat, bookmarks, the events worked example, messaging. */
    chatThreads: (orgId: string) => ['organizations', orgId, 'chat', 'threads'] as const,
    chatMessages: (orgId: string, threadId: string) =>
      ['organizations', orgId, 'chat', 'threads', threadId, 'messages'] as const,
    bookmarks: (orgId: string, kind?: string) =>
      ['organizations', orgId, 'bookmarks', kind ?? 'favorite'] as const,
    events: (orgId: string) => ['organizations', orgId, 'events'] as const,
    eventDetail: (orgId: string, eventId: string) =>
      ['organizations', orgId, 'events', eventId] as const,
    messages: (orgId: string, channel: string) =>
      ['organizations', orgId, 'messages', channel] as const,
    /** ManyHandz — chores library + categories. */
    chores: (orgId: string) => ['organizations', orgId, 'chores'] as const,
    choreDetail: (orgId: string, choreId: string) =>
      ['organizations', orgId, 'chores', choreId] as const,
    choreCategories: (orgId: string) => ['organizations', orgId, 'chore-categories'] as const,
  },

  users: {
    publicProfile: (userId: string) => ['users', userId, 'public'] as const,
  },

  billing: {
    /** Org-prefixed so invalidating an organization sweeps its billing summary too. */
    summary: (orgId: string) => ['organizations', orgId, 'billing', 'summary'] as const,
  },
} as const
