import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Section } from '@/components/gallery/kit'

/** Email + Billing — Resend + Stripe info. The Stripe checkout tester will land here. */

export default function BillingScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Email & Billing</Text>
      <Section title="Email + Billing" description="Resend + Stripe">
        <Text variant="muted">
          Wired server-side — deploy the Worker and set the keys to send email / run a checkout.
        </Text>
      </Section>
    </PageWrapper>
  )
}
