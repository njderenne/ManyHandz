import { Link, Stack } from 'expo-router'
import { Pressable, View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { APP_CONFIG } from '@/lib/config/app'

/**
 * Terms of Service — a config-driven DEFAULT (company name, support email, and trial/grace
 * periods interpolated from APP_CONFIG) that mirrors app/privacy.tsx in structure. Covers what
 * app-store and API reviewers look for: acceptance, accounts, acceptable use, subscription
 * billing, content ownership, an AI-accuracy disclaimer, termination, and liability limits.
 * Every claim is grounded in what the template actually does — keep it in sync as features
 * change. Replace the copy with your reviewed, jurisdiction-appropriate terms before launch —
 * this is a starting point, not legal advice.
 */

/** The factory sets this when minting an app; bump it whenever the terms text changes. */
const LAST_UPDATED = 'June 10, 2026'

/** Display alias for the tenant primitive (e.g. "organization", "household", "team"). */
const TENANT = APP_CONFIG.tenant.singular.toLowerCase()

type TermsSection = {
  h: string
  b: string
  /** Optional bullet list rendered after the body paragraph. */
  bullets?: string[]
  /** Optional closing paragraph rendered after the bullets. */
  f?: string
}

const SECTIONS: TermsSection[] = [
  {
    h: '1. Agreement to these Terms',
    b: `These Terms of Service ("Terms") are a binding agreement between you and ${APP_CONFIG.name} ("we", "us", "our") governing your use of our iOS and Android apps, our website (${APP_CONFIG.url}), and the services behind them (together, the "Service"). By creating an account or using the Service, you accept these Terms and our Privacy Policy. If you do not agree, do not use the Service. These Terms were last updated on ${LAST_UPDATED}.`,
  },
  {
    h: '2. The Service',
    b: `${APP_CONFIG.name} is ${APP_CONFIG.description} We may add, change, or remove features over time as the Service evolves. Some features are optional, may require device permissions, or may only be available on certain platforms or subscription plans.`,
  },
  {
    h: '3. Your account',
    b: 'To use most of the Service you need an account. You agree to:',
    bullets: [
      'Provide accurate information when you sign up and keep it up to date.',
      'Keep your credentials confidential — you are responsible for all activity under your account.',
      `Be at least 13 years old (or the minimum age in your jurisdiction). The Service is not directed at children.`,
      `Use ${TENANT} features responsibly — when you invite people to your ${TENANT}, you are responsible for having the right to share that content with them.`,
    ],
    f: `You can delete your account at any time in the app under Settings → Account. Tell us promptly at ${APP_CONFIG.support.email} if you suspect unauthorized use of your account.`,
  },
  {
    h: '4. Acceptable use',
    b: 'You agree not to misuse the Service. In particular, you will not:',
    bullets: [
      'Break the law, or infringe the rights (including intellectual-property rights) of others.',
      'Upload or share content that is illegal, harassing, hateful, or exploits minors.',
      'Probe, scan, overload, or disrupt the Service, or try to access data or accounts that are not yours.',
      'Reverse engineer, scrape, or resell the Service, or use it to build a competing product.',
      'Use AI features to generate content that is deceptive, harmful, or violates the usage policies of our AI providers.',
      'Circumvent billing, trials, or feature gates.',
    ],
    f: 'We may suspend or terminate accounts that violate these rules (see Section 8).',
  },
  {
    h: '5. Subscriptions and billing',
    b: `Parts of the Service require a paid subscription. Payments are processed by Stripe (or by Apple or Google when you subscribe through an app store); we never see your full card details.`,
    bullets: [
      `Free trial — new subscriptions may include a ${APP_CONFIG.subscription.trialDays}-day free trial. You will not be charged until the trial ends, and you can cancel anytime during the trial at no cost.`,
      'Auto-renewal — subscriptions renew automatically at the end of each billing period until you cancel. Cancel anytime; you keep access until the end of the period already paid for.',
      `Failed payments — if a renewal payment fails, we allow a grace period of ${APP_CONFIG.subscription.gracePeriodDays} days to update your payment method before paid features are suspended.`,
      'Price changes — we may change prices with advance notice; changes apply from your next billing period, never retroactively.',
      'Refunds — except where required by law or by app-store policy, payments are non-refundable.',
    ],
  },
  {
    h: '6. Your content',
    b: `You own the content you create or upload to the Service ("Your Content") — these Terms do not transfer ownership to us. So that we can operate the Service, you grant us a worldwide, non-exclusive, royalty-free license to host, store, transmit, process, display, and back up Your Content, solely as needed to provide, secure, and improve the Service (including processing by the service providers listed in our Privacy Policy). This license ends when Your Content is deleted from the Service, except for limited copies in routine backups until they expire. You are responsible for Your Content and must have the rights to anything you upload or share with your ${TENANT}.`,
  },
  {
    h: '7. AI features',
    b: `${APP_CONFIG.name} includes features powered by third-party AI models (see our Privacy Policy for the providers). AI-generated outputs are produced by statistical models and may be inaccurate, incomplete, or misleading — verify anything important before relying on it. AI outputs are not professional advice: nothing the Service generates is medical, legal, financial, or other professional advice, and it is not a substitute for consulting a qualified professional. You are responsible for how you use AI outputs.`,
  },
  {
    h: '8. Termination',
    b: `You can stop using the Service and delete your account at any time in the app. We may suspend or terminate your access if you materially breach these Terms, if required by law, or if we discontinue the Service (with reasonable notice where practicable). On termination, your right to use the Service ends; Sections 6 (license wind-down), 9, 10, and 11 survive. Data deletion after account termination is described in our Privacy Policy.`,
  },
  {
    h: '9. Disclaimers',
    b: `The Service is provided "as is" and "as available", without warranties of any kind, express or implied — including merchantability, fitness for a particular purpose, and non-infringement. We do not warrant that the Service will be uninterrupted, error-free, or that content (including AI outputs) will be accurate or reliable. Some jurisdictions do not allow certain warranty disclaimers, so parts of this section may not apply to you.`,
  },
  {
    h: '10. Limitation of liability',
    b: `To the maximum extent permitted by law: (a) we will not be liable for indirect, incidental, special, consequential, or punitive damages, or for lost profits, data, or goodwill; and (b) our total liability for all claims relating to the Service is limited to the greater of the amount you paid us in the 12 months before the claim arose or USD $100. These limits apply regardless of the theory of liability and even if we were advised of the possibility of damages. Nothing in these Terms limits liability that cannot be limited by law.`,
  },
  {
    h: '11. Governing law',
    b: `These Terms are governed by the laws of ${APP_CONFIG.legal.jurisdiction}, without regard to conflict-of-law rules, and disputes will be resolved in the courts of that jurisdiction unless applicable law gives you the right to a different venue. If any provision of these Terms is found unenforceable, the rest remain in effect.`,
  },
  {
    h: '12. Changes to these Terms',
    b: `We may update these Terms from time to time. When we do, we will revise the "Last updated" date above, and for material changes we will take reasonable steps to notify you, such as an in-app notice. Your continued use of the Service after changes take effect means you accept the updated Terms.`,
  },
  {
    h: '13. Contact us',
    b: `Questions about these Terms? Email ${APP_CONFIG.support.email} or visit ${APP_CONFIG.url}.`,
  },
]

export default function TermsScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Terms of Service' }} />
      <PageWrapper className="gap-5 pb-16">
        <View className="gap-1">
          <Text variant="h1">Terms of Service</Text>
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
        <Link href="/privacy" asChild>
          <Pressable className="active:opacity-70">
            <Text variant="body" className="text-primary">
              See also: our Privacy Policy →
            </Text>
          </Pressable>
        </Link>
        <Text variant="caption">
          This is a default template, not legal advice — have your terms reviewed for your
          jurisdictions before launch.
        </Text>
      </PageWrapper>
    </>
  )
}
