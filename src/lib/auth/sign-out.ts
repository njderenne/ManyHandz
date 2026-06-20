import { apiFetch } from '@/lib/api/client'
import { authClient } from '@/lib/auth/client'
import { registerForPush } from '@/lib/native/notifications'

/**
 * signOutEverywhere — THE logout. Screens never call `authClient.signOut()` directly; they call
 * this instead, so the device's push token is deregistered before the session ends. Without it,
 * push tokens outlive the session and on a shared device the previous user keeps receiving the
 * next user's pushes.
 *
 * Order matters: the deregister call needs the still-live session (the Worker scopes the delete
 * to the session user), so it runs before `signOut()`.
 *
 * Deregistration is best-effort: `registerForPush` returns null on web or without notification
 * permission (no token was ever registered, nothing to remove), and any network/API failure is
 * swallowed — a flaky connection must never block sign-out. The local sign-out itself still
 * throws on failure so callers can surface it (see app/account.tsx).
 */
export async function signOutEverywhere(): Promise<void> {
  try {
    // Reuses the registration helper: with permission already granted it resolves the current
    // device token without prompting — the same token /api/push/register stored. Without a grant
    // it returns null (the OS hands back a prior denial as-is, no re-prompt; see
    // src/lib/native/notifications.ts), so this step never blocks logout on a permission prompt —
    // and with no grant there was never a token to deregister anyway. It MUST stay ahead of
    // signOut() below: the Worker scopes the delete to the still-live session.
    const token = await registerForPush()
    if (token) {
      await apiFetch('/api/push/deregister', {
        method: 'POST',
        body: JSON.stringify({ token }),
      })
    }
  } catch {
    // Best-effort — never let push cleanup block the actual sign-out.
  }
  await authClient.signOut()
}
