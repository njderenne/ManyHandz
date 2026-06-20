/**
 * Notification tap routing — the central map from a notification's entity reference to the screen
 * that shows it. The Worker attaches { kind, entityType, entityId } to every push it sends
 * (worker/notify.ts); wireNotificationTaps() (./notifications.ts) feeds that payload through here
 * and navigates to the result.
 *
 * Minted apps EXTEND the switch with their product entities, keeping the template defaults:
 *
 *   case 'plant':
 *     return entityId ? `/plants/${entityId}` : '/plants'
 *
 * Return null to swallow a tap (the app opens, nothing navigates) — the default map never does:
 * a tap must always land somewhere, so unknowns fall back to the notifications inbox.
 */
export function routeForEntity(
  entityType?: string | null,
  entityId?: string | null,
): string | null {
  // The template's default targets are all list screens, so entityId goes unused until a minted
  // app adds a detail route (see JSDoc) — `void` keeps noUnusedParameters green meanwhile.
  void entityId

  switch (entityType) {
    case 'org':
    case 'member':
    case 'invitation':
      return '/team'
    case 'billing':
    case 'subscription':
      return '/account'
    case 'achievement':
      return '/achievements'
    // 'notification', a missing payload, or an entity this build doesn't know (e.g. a push sent
    // by a newer server version) all land on the inbox.
    default:
      return '/notifications'
  }
}
