/**
 * Roles & permissions — the app-layer RBAC config. Mirrors Better-Auth's organization roles.
 * Every privileged action checks `can(role, permission)`; the Worker enforces it server-side too.
 */
export const ROLES = ['owner', 'admin', 'member'] as const
export type Role = (typeof ROLES)[number]

export const PERMISSIONS: Record<Role, readonly string[]> = {
  owner: [
    'org:delete',
    'org:billing',
    'member:invite',
    'member:remove',
    'content:write',
    'content:read',
  ],
  admin: ['member:invite', 'content:write', 'content:read'],
  member: ['content:read'],
}

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
}

/** Whether a role is granted a permission. Use at every gated action (and in the Worker). */
export function can(role: Role, permission: string): boolean {
  return PERMISSIONS[role].includes(permission)
}
