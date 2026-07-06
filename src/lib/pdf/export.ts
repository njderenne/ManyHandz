import { Platform } from 'react-native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'

/**
 * On-device PDF export — turns an HTML document (build one with buildReportDocument in ./html-report)
 * into a PDF, with no server round-trip. Web opens the browser print dialog ("Save as PDF"); native
 * writes a PDF file and hands it to the share sheet.
 *
 * Why the platform branch: `Print.printToFileAsync` is native-only — on web it would throw — so web
 * uses `Print.printAsync({ html })` to drive the browser's own print/Save-as-PDF flow. Depends on
 * expo-print + expo-sharing.
 */

export type ExportPdfOptions = {
  /** Native file/share name (no extension); also the share-sheet dialog title fallback. */
  filename?: string
  /** Title shown on the native share sheet. */
  dialogTitle?: string
}

export type ExportPdfResult =
  /** Web: the browser print dialog was opened. */
  | { platform: 'web' }
  /** Native: a PDF file was written; `shared` is true when handed to the share sheet. */
  | { platform: 'native'; uri: string; shared: boolean }

/**
 * Render `html` to a PDF on device. Returns where the PDF went so the caller can toast/log. Throws on
 * a print/share failure — wrap the call in try/catch (or useAsyncAction in the dev gallery).
 */
export async function exportHtmlToPdf(
  html: string,
  { filename = 'document', dialogTitle = 'Export PDF' }: ExportPdfOptions = {},
): Promise<ExportPdfResult> {
  if (Platform.OS === 'web') {
    // Web: opens the browser print dialog → "Save as PDF". (printToFileAsync is native-only.)
    await Print.printAsync({ html })
    return { platform: 'web' }
  }

  const { uri } = await Print.printToFileAsync({ html })
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, {
      mimeType: 'application/pdf',
      UTI: 'com.adobe.pdf',
      dialogTitle: dialogTitle || filename,
    })
    return { platform: 'native', uri, shared: true }
  }
  return { platform: 'native', uri, shared: false }
}
