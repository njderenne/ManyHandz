import { describe, it, expect } from 'vitest'
import {
  passwordResetEmail,
  verifyEmail,
  welcomeEmail,
  orgInviteEmail,
  EMAIL_PREVIEWS,
} from './templates'
import { APP_CONFIG } from '@/lib/config/app'

describe('email templates', () => {
  it('password reset carries the url + brand', () => {
    const url = 'https://example.com/reset?token=xyz'
    const { subject, html } = passwordResetEmail(url)
    expect(subject).toContain('Reset')
    expect(html).toContain(url)
    expect(html).toContain(APP_CONFIG.name)
  })

  it('verify carries the url', () => {
    expect(verifyEmail('https://x/verify?t=1').html).toContain('https://x/verify?t=1')
  })

  it('welcome greets the name', () => {
    expect(welcomeEmail('Will').html).toContain('Will')
  })

  it('org invite names the inviter and the org', () => {
    const html = orgInviteEmail('Nate', 'Acme Inc', 'https://x/invite/abc').html
    expect(html).toContain('Nate')
    expect(html).toContain('Acme Inc')
    expect(html).toContain('https://x/invite/abc')
  })

  it('escapes user-provided names — markup arrives as text, never as elements', () => {
    const evil = '<script>alert(1)</script><b>x</b>'

    const welcome = welcomeEmail(evil).html
    expect(welcome).not.toContain(evil)
    expect(welcome).not.toContain('<script>')
    expect(welcome).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&lt;b&gt;x&lt;/b&gt;')

    const invite = orgInviteEmail(evil, 'Acme & Sons "LLC"', 'https://x/invite/abc')
    expect(invite.html).not.toContain('<script>')
    expect(invite.html).toContain('&lt;script&gt;')
    expect(invite.html).toContain('Acme &amp; Sons &quot;LLC&quot;')
    // The server-generated URL stays raw — escaping applies to user strings only.
    expect(invite.html).toContain('https://x/invite/abc')

    // The SUBJECT is a plain-text RFC 5322 header, not HTML: entity-escaping there would garble
    // every real "O'Brien" / "Acme & Sons" — raw text is correct (headers never render markup).
    const benign = orgInviteEmail("Will O'Brien", 'Acme & Sons', 'https://x/invite/abc')
    expect(benign.subject).toBe("Will O'Brien invited you to Acme & Sons")
    expect(benign.subject).not.toContain('&#39;')
    expect(benign.subject).not.toContain('&amp;')
  })

  it('every preview renders a subject + non-trivial html', () => {
    for (const [name, email] of Object.entries(EMAIL_PREVIEWS)) {
      expect(email.subject, name).toBeTruthy()
      expect(email.html.length, name).toBeGreaterThan(100)
    }
  })
})
