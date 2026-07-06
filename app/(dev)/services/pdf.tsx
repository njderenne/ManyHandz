import { View } from 'react-native'
import * as Crypto from 'expo-crypto'
import { PageWrapper } from '@/components/layout/page-wrapper'
import { Text } from '@/components/ui/text'
import { Button } from '@/components/ui/button'
import { Section } from '@/components/gallery/kit'
import { useAsyncAction, Result } from '@/components/gallery/async-action'
import { buildReportDocument, esc, type IntegrityStamp } from '@/lib/pdf/html-report'
import { exportHtmlToPdf } from '@/lib/pdf/export'

/**
 * PDF export tester — builds a tiny sample report with buildReportDocument + a tamper-evident
 * integrity stamp, then exports it on device (web: print dialog → Save as PDF; native: share sheet).
 * Mirrors the worker's stampContent shape (worker/lib/integrity.ts), but hashes client-side with
 * expo-crypto so this gallery screen works with no Worker deployed.
 */

const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ' // Crockford-ish (no I/L/O/U)

function authCode16(): string {
  const bytes = Crypto.getRandomBytes(16)
  let out = ''
  for (let i = 0; i < 16; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  return `${out.slice(0, 4)}-${out.slice(4, 8)}-${out.slice(8, 12)}-${out.slice(12, 16)}`
}

/** Stamp the CONTENT only — volatile fields (generatedAt) stay OUT of the hashed payload. */
async function stampContent(payload: unknown): Promise<IntegrityStamp> {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    JSON.stringify(payload),
  )
  return { algorithm: 'SHA-256', hash, verificationCode: authCode16() }
}

async function exportSampleReport(): Promise<string> {
  // The attested content (no timestamps inside).
  const content = {
    items: [
      { date: '2026-01-04', label: 'Sample item one', amount: '$12.00', status: 'approved' },
      { date: '2026-01-09', label: 'Sample item two', amount: '$48.50', status: 'pending' },
    ],
  }
  const stamp = await stampContent(content)
  const generatedAt = new Date() // volatile — outside the stamp

  const html = buildReportDocument({
    title: 'Sample report',
    subtitle: `Generated ${generatedAt.toLocaleString()}`,
    leadNote:
      'This is a tamper-evident document. The content below is sealed with a SHA-256 hash and a ' +
      'verification code shown on every page. Re-hashing the original content reproduces the same ' +
      'hash only if nothing was altered; the verification code is a fixed reference label for this document.',
    sections: [
      {
        title: 'Items',
        headers: ['Date', 'Description', 'Amount', 'Status'],
        rows: content.items.map((it) => [
          esc(it.date),
          esc(it.label),
          `<strong>${esc(it.amount)}</strong>`,
          `<span class="badge">${esc(it.status)}</span>`,
        ]),
      },
    ],
    footerLeft: 'Sample report',
    footerRight: `Verification <code>${esc(stamp.verificationCode)}</code> · ${esc(stamp.algorithm)} <code>${esc(stamp.hash.slice(0, 16))}…</code>`,
  })

  const result = await exportHtmlToPdf(html, {
    filename: 'sample-report',
    dialogTitle: 'Sample report',
  })
  return result.platform === 'web' ? 'Opened print dialog' : result.shared ? 'Shared PDF' : 'PDF saved'
}

export default function PdfScreen() {
  const { state, run } = useAsyncAction()
  return (
    <PageWrapper className="gap-8 pb-24">
      <Text variant="h1">PDF export</Text>
      <Section
        title="Tamper-evident report"
        description="Build an HTML report + integrity stamp → export to PDF on device"
      >
        <View className="gap-3">
          <Button
            label="Export sample PDF"
            loading={state.status === 'loading'}
            onPress={() => run(exportSampleReport)}
          />
          <Result state={state} />
        </View>
      </Section>
    </PageWrapper>
  )
}
