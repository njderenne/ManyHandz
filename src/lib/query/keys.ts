/**
 * Query-key registry — the single source of truth for TanStack Query keys.
 * Keep keys hierarchical so org-scoped invalidation is a prefix match.
 */
export const queryKeys = {
  health: ['health'] as const,

  session: ['session'] as const,

  /** The caller's user_settings row (notification prefs, marketing consent, locale, timezone). */
  userSettings: ['user', 'settings'] as const,

  /** The caller's connected third-party OAuth integrations (user-scoped, not org-scoped). */
  integrations: ['integrations'] as const,

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
    /** Subject primitive (Person ≠ Member ≠ User) — feature-gated module. */
    subjects: (orgId: string, kind?: string) =>
      ['organizations', orgId, 'subjects', kind ?? 'all'] as const,
    subjectDetail: (orgId: string, subjectId: string) =>
      ['organizations', orgId, 'subjects', 'detail', subjectId] as const,
    /** Share-grant layer (named, scoped, time-boxed outsider access). */
    grants: (orgId: string) => ['organizations', orgId, 'grants'] as const,
    grantActivity: (orgId: string, grantId: string) =>
      ['organizations', orgId, 'grants', grantId, 'activity'] as const,
    /** Escalation ladder (safety module). */
    escalations: (orgId: string) => ['organizations', orgId, 'escalations'] as const,
    /** Prompt/nudge engine — subjectId omitted = the org-level track. */
    prompts: (orgId: string, subjectId?: string) =>
      ['organizations', orgId, 'prompts', subjectId ?? 'org'] as const,
    /** Range-metrics report generator ('reports' is ManyHandz's weekly report — do not rename). */
    generatedReports: (orgId: string) => ['organizations', orgId, 'generated-reports'] as const,
    generatedReportDetail: (orgId: string, reportId: string) =>
      ['organizations', orgId, 'generated-reports', reportId] as const,
    /** Seeded reference catalog (global rows + org customs, one list). */
    catalog: (orgId: string, kind?: string) =>
      ['organizations', orgId, 'catalog', kind ?? 'all'] as const,
    /** ManyHandz — household config + the chores library + categories. */
    household: (orgId: string) => ['organizations', orgId, 'household'] as const,
    chores: (orgId: string) => ['organizations', orgId, 'chores'] as const,
    choreDetail: (orgId: string, choreId: string) =>
      ['organizations', orgId, 'chores', choreId] as const,
    choreCategories: (orgId: string) => ['organizations', orgId, 'chore-categories'] as const,
    assignments: (orgId: string) => ['organizations', orgId, 'assignments'] as const,
    assignmentDetail: (orgId: string, id: string) => ['organizations', orgId, 'assignments', id] as const,
    rotations: (orgId: string) => ['organizations', orgId, 'rotations'] as const,
    completions: (orgId: string, status: string) => ['organizations', orgId, 'completions', status] as const,
    // --- Breadth resources (built by the feature fleet; registered here so hooks share the registry) ---
    rewards: (orgId: string) => ['organizations', orgId, 'rewards'] as const,
    rewardRedemptions: (orgId: string) => ['organizations', orgId, 'reward-redemptions'] as const,
    goals: (orgId: string) => ['organizations', orgId, 'goals'] as const,
    goalDetail: (orgId: string, id: string) => ['organizations', orgId, 'goals', id] as const,
    settlements: (orgId: string) => ['organizations', orgId, 'settlements'] as const,
    shoppingLists: (orgId: string) => ['organizations', orgId, 'shopping-lists'] as const,
    shoppingItems: (orgId: string, listId: string) =>
      ['organizations', orgId, 'shopping-lists', listId, 'items'] as const,
    quickTasks: (orgId: string) => ['organizations', orgId, 'quick-tasks'] as const,
    polls: (orgId: string) => ['organizations', orgId, 'polls'] as const,
    announcements: (orgId: string) => ['organizations', orgId, 'announcements'] as const,
    assignmentComments: (orgId: string, assignmentId: string) =>
      ['organizations', orgId, 'assignments', assignmentId, 'comments'] as const,
    challenges: (orgId: string) => ['organizations', orgId, 'challenges'] as const,
    competitions: (orgId: string) => ['organizations', orgId, 'competitions'] as const,
    gifts: (orgId: string) => ['organizations', orgId, 'gifts'] as const,
    customBadges: (orgId: string) => ['organizations', orgId, 'custom-badges'] as const,
    memberBadges: (orgId: string, memberId: string) =>
      ['organizations', orgId, 'members', memberId, 'badges'] as const,
    milestones: (orgId: string) => ['organizations', orgId, 'milestones'] as const,
    fairness: (orgId: string, period: string) => ['organizations', orgId, 'fairness', period] as const,
    reports: (orgId: string) => ['organizations', orgId, 'reports'] as const,
    snoozeRequests: (orgId: string) => ['organizations', orgId, 'snooze-requests'] as const,
    swapRequests: (orgId: string) => ['organizations', orgId, 'swap-requests'] as const,
    activityFeed: (orgId: string) => ['organizations', orgId, 'activity-feed'] as const,
    mealPlan: (orgId: string, weekStart: string) => ['organizations', orgId, 'meal-plan', weekStart] as const,
  },

  users: {
    publicProfile: (userId: string) => ['users', userId, 'public'] as const,
  },

  billing: {
    /** Org-prefixed so invalidating an organization sweeps its billing summary too. */
    summary: (orgId: string) => ['organizations', orgId, 'billing', 'summary'] as const,
    /** Public — NOT org-scoped (prices are public; consumed pre-auth). staleTime 5 min. */
    plans: () => ['billing', 'plans'] as const,
  },

  /** Session-less public grant resolve — never org-prefixed (no org id exists client-side). */
  publicGrant: (code: string) => ['public', 'grant', code] as const,
} as const
