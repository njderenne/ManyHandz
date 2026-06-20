import { Link, Stack } from 'expo-router'
import { Pressable, View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Privacy Policy — a thorough, config-driven DEFAULT (company name + support email interpolated)
 * written to the standard API providers expect when reviewing an app (OAuth verification,
 * payment/health API reviews): named subprocessors, AI-processing disclosure, in-app deletion,
 * retention, GDPR/CCPA rights, COPPA, international transfers. Every claim is grounded in what
 * the template actually does — keep it in sync when you add or swap providers. Replace the copy
 * with your reviewed, jurisdiction-appropriate policy before launch — this is a starting point,
 * not legal advice.
 */

/** The factory sets this when minting an app; bump it whenever the policy text changes. */
const LAST_UPDATED = 'June 10, 2026'

/** Display alias for the tenant primitive (e.g. "organization", "household", "team"). */
const TENANT = APP_CONFIG.tenant.singular.toLowerCase()

type PolicySection = {
  h: string
  b: string
  /** Optional bullet list rendered after the body paragraph. */
  bullets?: string[]
  /** Optional closing paragraph rendered after the bullets. */
  f?: string
}

const SECTIONS: PolicySection[] = [
  {
    h: '1. Scope',
    b: `This Privacy Policy describes how ${APP_CONFIG.name} ("we", "us", "our") collects, uses, and shares information about you when you use our iOS and Android apps, our website (${APP_CONFIG.url}), and the services behind them (together, the "Service"). By using the Service, you agree to the practices described in this policy. This policy was last updated on ${LAST_UPDATED}.`,
  },
  {
    h: '2. Information we collect',
    b: 'We collect the following categories of information:',
    bullets: [
      `Account data — your name, email address, and password when you create an account. Passwords are stored only in hashed form, never as plain text. If you sign in with Google or Apple (where offered), we receive basic profile information from that provider, such as your name and email address. If you register a passkey, we store its public key; the biometric check happens on your device, and your biometric data never leaves it.`,
      `Content you create — the information you choose to enter or store in ${APP_CONFIG.name}, including content you share within your ${TENANT}.`,
      `${APP_CONFIG.tenant.singular} data — when you create or join one, we store its name, your membership and role, and the email addresses of people you invite.`,
      `Voice recordings and images — if you use voice or image features, the recordings, photos, or images you submit are processed to deliver that feature (see Section 5).`,
      `Payment data — payments are processed by Stripe. Your card details are entered directly with Stripe and never touch our servers; we store only your subscription status and Stripe customer and subscription identifiers.`,
      `Device and usage data — if you enable push notifications, we store your device's push token and platform so we can deliver them. Like most online services, our servers also process technical request data (such as your IP address and browser or device user agent) to operate and secure the Service, including as part of session records.`,
    ],
  },
  {
    h: '3. Device permissions',
    b: `Some features use device capabilities such as the camera and photo library, microphone, location, calendar, notifications, and biometric unlock (e.g. Face ID or fingerprint). Permissions are requested only when you use the corresponding feature, and you can revoke them at any time in your device settings. Biometric authentication is performed by your device's operating system — the app receives only the result, never your biometric data.`,
  },
  {
    h: '4. How we use information',
    b: 'We use the information we collect to:',
    bullets: [
      'Provide, operate, and maintain the Service.',
      'Authenticate you and keep your session secure.',
      'Process subscription payments and manage billing.',
      `Send transactional email, such as email verification, password resets, and ${TENANT} invitations.`,
      'Deliver push notifications you have enabled.',
      'Respond to your support requests.',
      'Monitor, debug, and improve the Service and protect it against abuse.',
    ],
  },
  {
    h: '5. AI features and processing',
    b: `${APP_CONFIG.name} includes features powered by third-party AI providers. When you use these features, the content you submit — text prompts, voice recordings, or images — is sent to the relevant provider to generate the response:`,
    bullets: [
      'Text and reasoning — Anthropic (Claude) and OpenAI.',
      'Image understanding and generation — xAI (Grok).',
      'Speech-to-text and text-to-speech — ElevenLabs.',
      'Image background removal — rembg.com or Replicate, depending on configuration.',
    ],
    f: `Your content is transmitted to these providers on a per-request basis, only when you use the feature, and solely to generate your response. Each provider handles it under its own API terms. We do not use your content to train AI models.`,
  },
  {
    h: '6. Service providers (subprocessors)',
    b: 'We share personal information with the service providers that run parts of the Service on our behalf, each receiving only the data it needs for its role:',
    bullets: [
      'Cloudflare — application hosting and edge network.',
      'Neon — database hosting.',
      'Stripe — payment and subscription processing.',
      'Resend — transactional email delivery.',
      'Expo (EAS) — app builds, updates, and push notification delivery.',
      'Anthropic, OpenAI, and xAI — AI text, vision, and image processing (when you use AI features).',
      'ElevenLabs — voice transcription and speech synthesis (when you use voice features).',
      'rembg.com / Replicate — image background removal (when you use image features; which provider depends on app configuration).',
      'Google and Apple — sign-in (only if you choose to sign in with them).',
    ],
  },
  {
    h: '7. Data retention and deletion',
    b: `We keep your information while your account is active. You can delete your account at any time in the app under Settings → Account → Delete account; deletion removes your account and the personal data associated with it from our production database. Copies may persist for a limited period in routine database backups before they expire, and we may retain limited records (such as payment and billing records) where required for legal, tax, or accounting purposes. You can also request deletion by emailing ${APP_CONFIG.support.email}.`,
  },
  {
    h: '8. Security',
    b: `All communication between your device and our servers is encrypted in transit using TLS (HTTPS). Session tokens are kept in your device's platform secure storage (iOS Keychain / Android Keystore), API requests that access your data require authentication, and data access is scoped to your account and ${TENANT}. No method of transmission or storage is completely secure, but we work to protect your information with measures like these.`,
  },
  {
    h: '9. How we share information',
    b: `We do not sell your personal information, and we do not share it with advertising networks. Beyond the service providers listed above, we disclose information only when required by law or legal process, to protect the rights, safety, or property of our users or others, or as part of a business transaction (such as a merger or acquisition), in which case your information remains subject to this policy.`,
  },
  {
    h: '10. Your privacy rights',
    b: 'Depending on where you live, you may have rights regarding your personal information, including:',
    bullets: [
      'Access — request a copy of the personal information we hold about you.',
      'Rectification — correct inaccurate or incomplete information.',
      'Erasure — delete your account and personal data (available in-app; see Section 7).',
      'Portability — receive your data in a structured, machine-readable format.',
      'Objection and restriction — object to or restrict certain processing.',
      'California residents — the rights to know, correct, and delete personal information, and to opt out of its sale or sharing. We do not sell personal information or share it for cross-context behavioral advertising.',
    ],
    f: `To exercise any of these rights, email ${APP_CONFIG.support.email}. We will verify your request and respond within the timeframe required by applicable law. If you are in the EU/EEA or UK, you may also lodge a complaint with your local supervisory authority.`,
  },
  {
    h: '11. Children’s privacy',
    b: `${APP_CONFIG.name} is not directed at children under 13 (or the equivalent minimum age in your jurisdiction), and we do not knowingly collect personal information from them. If you believe a child has provided us personal information, contact ${APP_CONFIG.support.email} and we will delete it.`,
  },
  {
    h: '12. International data transfers',
    b: `We and our service providers process data primarily in the United States. If you use the Service from outside the US, your information will be transferred to and processed in the US and other countries where our providers operate, which may have different data protection laws than your jurisdiction. Where required, transfers are made subject to the safeguards in our providers' data processing terms.`,
  },
  {
    h: '13. Changes to this policy',
    b: `We may update this policy from time to time. When we do, we will revise the "Last updated" date above, and for material changes we will take reasonable steps to notify you, such as an in-app notice. Your continued use of the Service after changes take effect means you accept the updated policy.`,
  },
  {
    h: '14. Contact us',
    b: `Questions or concerns about this policy or your data? Email ${APP_CONFIG.support.email} or visit ${APP_CONFIG.url}.`,
  },
]

export default function PrivacyScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Privacy Policy' }} />
      <PageWrapper className="gap-5 pb-16">
        <View className="gap-1">
          <Text variant="h1">Privacy Policy</Text>
          <Text variant="muted">{APP_CONFIG.name}</Text>
          <Text variant="muted">Last updated: {LAST_UPDATED}</Text>
        </View>
        {SECTIONS.map((s) => (
          <View key={s.h} className="gap-1.5">
            <Text variant="h3">{s.h}</Text>
            <Text variant="body">{s.b}</Text>
            {s.bullets?.map((item) => (
              <View key={item} className="flex-row gap-2 pl-1">
                <Text variant="body">{'•'}</Text>
                <Text variant="body" className="flex-1">
                  {item}
                </Text>
              </View>
            ))}
            {s.f ? <Text variant="body">{s.f}</Text> : null}
          </View>
        ))}
        <Link href="/terms" asChild>
          <Pressable className="active:opacity-70">
            <Text variant="body" className="text-primary">
              See also: our Terms of Service →
            </Text>
          </Pressable>
        </Link>
        <Text variant="caption">
          This is a default template, not legal advice — have your policy reviewed for your
          jurisdictions before launch.
        </Text>
      </PageWrapper>
    </>
  )
}
