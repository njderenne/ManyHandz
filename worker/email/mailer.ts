import { Resend } from 'resend'
import type { Env } from '../env'
import { APP_CONFIG } from '@/lib/config/app'
import {
  passwordResetEmail,
  verifyEmail,
  welcomeEmail,
  orgInviteEmail,
  feedbackEmail,
  type Email,
  type FeedbackEmailInput,
} from './templates'

/**
 * Mailer — sends the transactional emails via Resend. Built per-request from the Worker env
 * (the API key is a Worker secret). If RESEND_API_KEY is unset (e.g. local dev), it logs and
 * no-ops so flows don't crash. `EMAIL_FROM` must be a verified Resend sender.
 *
 * Fleet standard: ONE studio mailbox (support@criterial.io) serves every app — per-app identity
 * comes from the DISPLAY NAME ("PlantPal <support@criterial.io>"), never from per-app mailboxes.
 * EMAIL_FROM stays a bare address in env; the display name is derived from APP_CONFIG here.
 *
 * Reply routing: recipients see the app's identity (footer shows the app name, not the raw inbox —
 * see layout.ts), but every send carries a Reply-To = APP_CONFIG.support.email so a reply lands in
 * the shared studio inbox invisibly. The visible From stays the display-name pattern.
 */
export function createMailer(env: Env) {
  const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null
  const address = env.EMAIL_FROM ?? 'onboarding@resend.dev'
  // If env already carries a display name ("X <a@b>"), respect it; otherwise add the app's.
  const from = address.includes('<') ? address : `${APP_CONFIG.name} <${address}>`
  const replyTo = APP_CONFIG.support.email

  async function send(to: string, email: Email) {
    if (!resend) {
      console.warn(`[email] RESEND_API_KEY not set — skipping "${email.subject}" to ${to}`)
      return
    }
    await resend.emails.send({ from, replyTo, to, subject: email.subject, html: email.html })
  }

  return {
    sendPasswordReset: (to: string, url: string) => send(to, passwordResetEmail(url)),
    sendVerification: (to: string, url: string) => send(to, verifyEmail(url)),
    sendWelcome: (to: string, name: string) => send(to, welcomeEmail(name)),
    sendOrgInvite: (to: string, inviterName: string, orgName: string, url: string) =>
      send(to, orgInviteEmail(inviterName, orgName, url)),
    /** Internal: notify the studio support inbox of a new in-app feedback submission. */
    sendFeedback: (to: string, input: FeedbackEmailInput) => send(to, feedbackEmail(input)),
  }
}

export type Mailer = ReturnType<typeof createMailer>
