import { View } from 'react-native'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { referralCode, shareReferral } from '@/lib/referrals'

/** Referrals tester — shareable code via the native share sheet. */

function ReferralTester() {
  const code = referralCode('demo-user-123')
  return (
    <View className="gap-3">
      <Text variant="muted">
        Your code: <Text variant="label">{code}</Text>
      </Text>
      <Button label="Share invite" onPress={() => shareReferral(code)} />
    </View>
  )
}

export default function ReferralsScreen() {
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">Referrals</Text>
      <Section title="Referrals" description="Shareable code via the native share sheet">
        <ReferralTester />
      </Section>
    </PageWrapper>
  )
}
