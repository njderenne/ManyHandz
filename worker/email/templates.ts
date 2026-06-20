import { APP_CONFIG } from '@/lib/config/app'
import { emailLayout } from './layout'

/**
 * Transactional email templates — each returns `{ subject, html }`. Add new ones here; they all
 * compose the branded `emailLayout`. Keep copy short, warm, and action-oriented.
 */
export type Email = { subject: string; html: string }

/**
 * HTML-entity escape for USER-PROVIDED strings (names, org names — anyone can sign up as
 * `<script>…`) before they hit `emailLayout`, which interpolates raw (its body field is
 * intentionally HTML so templates can use markup). Server-generated URLs stay raw — they are
 * composed from config + tokens, never from user input.
 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function passwordResetEmail(url: string): Email {
  return {
    subject: `Reset your ${APP_CONFIG.name} password`,
    html: emailLayout({
      heading: 'Reset your password',
      body: 'We got a request to reset your password. Choose a new one with the button below — this link expires in 1 hour.',
      button: { label: 'Reset password', url },
      footnote: "If you didn't request this, you can safely ignore this email — your password won't change.",
    }),
  }
}

export function verifyEmail(url: string): Email {
  return {
    subject: `Confirm your email for ${APP_CONFIG.name}`,
    html: emailLayout({
      heading: 'Confirm your email',
      body: `Welcome to ${APP_CONFIG.name}! Tap below to verify your email address and finish setting up your account.`,
      button: { label: 'Verify email', url },
    }),
  }
}

export function welcomeEmail(name: string): Email {
  return {
    subject: `Welcome to ${APP_CONFIG.name}`,
    html: emailLayout({
      heading: `Welcome, ${escapeHtml(name)}!`,
      body: `Thanks for joining ${APP_CONFIG.name}. We're glad you're here — open the app to get started.`,
      button: { label: 'Open the app', url: APP_CONFIG.url },
    }),
  }
}

export function orgInviteEmail(inviterName: string, orgName: string, url: string): Email {
  // Escape ONLY the HTML surfaces. The subject is a plain-text RFC 5322 header — entity-escaping
  // it garbles every real name with an apostrophe/ampersand ("Will O'Brien" -> "Will O&#39;Brien").
  const inviter = escapeHtml(inviterName)
  const org = escapeHtml(orgName)
  return {
    subject: `${inviterName} invited you to ${orgName}`,
    html: emailLayout({
      heading: `Join ${org}`,
      body: `<strong>${inviter}</strong> invited you to collaborate on <strong>${org}</strong> in ${APP_CONFIG.name}.`,
      button: { label: 'Accept invitation', url },
      footnote: 'This invitation will expire in 7 days.',
    }),
  }
}

/** Fields carried into the internal feedback-notification email. All are user-provided or env. */
export type FeedbackEmailInput = {
  category: string | null
  message: string
  appVersion: string | null
  platform: string | null
  submitterName: string | null
  submitterEmail: string | null
}

/**
 * Internal notification sent to the studio support inbox when a user submits in-app feedback.
 * NOT user-facing — it just routes the submission to a human. Every interpolated value is
 * user-provided, so each is HTML-escaped before hitting `emailLayout` (which renders body raw).
 */
export function feedbackEmail(input: FeedbackEmailInput): Email {
  const dash = (v: string | null) => (v && v.trim() ? escapeHtml(v) : '—')
  const category = input.category && input.category.trim() ? escapeHtml(input.category) : 'feedback'
  const submitter =
    input.submitterName || input.submitterEmail
      ? `${dash(input.submitterName)} (${dash(input.submitterEmail)})`
      : '—'
  return {
    subject: `New ${APP_CONFIG.name} feedback: ${category}`,
    html: emailLayout({
      heading: 'New feedback',
      body: [
        `<strong>Category:</strong> ${category}`,
        `<strong>From:</strong> ${submitter}`,
        `<strong>Platform:</strong> ${dash(input.platform)}`,
        `<strong>App version:</strong> ${dash(input.appVersion)}`,
        `<br/><strong>Message:</strong><br/>${escapeHtml(input.message).replace(/\n/g, '<br/>')}`,
      ].join('<br/>'),
    }),
  }
}

/** Used by the dev preview route to render each template with placeholder data. */
export const EMAIL_PREVIEWS: Record<string, Email> = {
  reset: passwordResetEmail('https://example.com/reset-password?token=demo'),
  verify: verifyEmail('https://example.com/verify?token=demo'),
  welcome: welcomeEmail('Will'),
  invite: orgInviteEmail('Nate', 'Acme Inc', 'https://example.com/accept-invite/demo'),
  feedback: feedbackEmail({
    category: 'bug',
    message: 'The save button does nothing on iOS.',
    appVersion: '1.2.0',
    platform: 'ios',
    submitterName: 'Will',
    submitterEmail: 'will@example.com',
  }),
}
