import { APP_CONFIG } from '@/lib/config/app'

/**
 * Branded email shell — table-based, inline-styled HTML for broad email-client support. Light
 * theme (the email convention). The accent should match the app's brand color (kept in sync
 * manually — emails render server-side and can't read the RN theme).
 */
const BRAND = '#6366f1'

export type EmailContent = {
  heading: string
  /** Body paragraphs (HTML-safe strings). */
  body: string
  button?: { label: string; url: string }
  footnote?: string
}

export function emailLayout({ heading, body, button, footnote }: EmailContent): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr><td style="padding:28px 32px 0;">
              <span style="font-size:18px;font-weight:700;color:${BRAND};">${APP_CONFIG.name}</span>
            </td></tr>
            <tr><td style="padding:18px 32px 4px;">
              <h1 style="margin:0;font-size:22px;font-weight:700;color:#0f172a;">${heading}</h1>
            </td></tr>
            <tr><td style="padding:8px 32px;font-size:15px;line-height:1.6;color:#334155;">${body}</td></tr>
            ${
              button
                ? `<tr><td style="padding:12px 32px 8px;">
                     <a href="${button.url}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:600;font-size:15px;">${button.label}</a>
                   </td></tr>`
                : ''
            }
            ${
              footnote
                ? `<tr><td style="padding:6px 32px 12px;font-size:13px;line-height:1.5;color:#64748b;">${footnote}</td></tr>`
                : ''
            }
            <tr><td style="padding:20px 32px 28px;border-top:1px solid #f1f5f9;font-size:12px;color:#94a3b8;">
              ${APP_CONFIG.name} &middot; Questions? Just reply to this email.
            </td></tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}
