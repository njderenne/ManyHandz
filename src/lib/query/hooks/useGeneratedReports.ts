import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api/client'
import { queryKeys } from '@/lib/query/keys'

/**
 * useGeneratedReports — client side of the range-metrics report generator
 * (worker/routes/generated-reports.ts; math in worker/engines/range-metrics.ts). Named
 * generated-reports because `/reports` belongs to moderation — same rule as the query keys.
 *
 * The row's `data` is the deterministic engine DTO (RangeMetricsData — mirror the shape from
 * worker/engines/range-metrics.ts when rendering); `summary` is editable prose, null until an
 * AI pass or a human writes it. Generation and summary-editing are 'content:write' actions on
 * the Worker — screens can gate their buttons with the matching capability check client-side.
 *
 * Hooks stay toast-free — screens own user feedback per call.
 */

/** Client mirror of the generated_report row — Dates arrive as ISO strings over JSON. */
export type GeneratedReportDto = {
  id: string
  organizationId: string
  subjectId: string | null
  kind: string
  rangeStart: string
  rangeEnd: string
  /** The engine DTO (worker/engines/range-metrics.ts RangeMetricsData) — render, don't edit. */
  data: Record<string, unknown>
  summary: string | null
  createdByMemberId: string | null
  createdAt: string
  updatedAt: string
}

/** Suffix the canonical list key per subject filter — different responses, different entries;
 *  invalidating the canonical key sweeps every suffixed variant (prefix match). */
const listKey = (orgId: string, subjectId?: string) =>
  subjectId
    ? ([...queryKeys.organizations.generatedReports(orgId), subjectId] as const)
    : queryKeys.organizations.generatedReports(orgId)

/** The org's reports, newest first — optionally narrowed to one subject. */
export function useGeneratedReports(orgId: string, subjectId?: string) {
  return useQuery({
    queryKey: listKey(orgId, subjectId),
    queryFn: () =>
      apiFetch<GeneratedReportDto[]>(
        `/api/organizations/${orgId}/generated-reports${
          subjectId ? `?subjectId=${encodeURIComponent(subjectId)}` : ''
        }`,
      ),
    enabled: Boolean(orgId),
  })
}

/** One report (the detail/print screen reads `data` + `summary` from here). */
export function useGeneratedReport(orgId: string, reportId: string) {
  return useQuery({
    queryKey: queryKeys.organizations.generatedReportDetail(orgId, reportId),
    queryFn: () =>
      apiFetch<GeneratedReportDto>(`/api/organizations/${orgId}/generated-reports/${reportId}`),
    enabled: Boolean(orgId && reportId),
  })
}

export type GenerateReportInput = {
  /** Must be a kind the app registered in the Worker's reportLoaders ('activity' ships). */
  kind: string
  subjectId?: string
  /** ISO datetime or YYYY-MM-DD. */
  rangeStart: string
  rangeEnd: string
}

/**
 * Generate a report. Not optimistic — the Worker runs the loader + engine and owns the result;
 * the fresh row seeds the detail cache and the settled invalidation re-syncs the lists.
 */
export function useGenerateReport(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: GenerateReportInput) =>
      apiFetch<GeneratedReportDto>(`/api/organizations/${orgId}/generated-reports`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: (report) => {
      queryClient.setQueryData<GeneratedReportDto>(
        queryKeys.organizations.generatedReportDetail(orgId, report.id),
        report,
      )
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.generatedReports(orgId),
      }),
  })
}

export type UpdateReportSummaryInput = {
  reportId: string
  /** Non-empty prose sets; null or '' clears (the Worker treats both as clear). ≤ 8 KB. */
  summary: string | null
}

/** Edit/clear a report's prose summary before sharing or printing. */
export function useUpdateReportSummary(orgId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ reportId, summary }: UpdateReportSummaryInput) =>
      apiFetch<GeneratedReportDto>(
        `/api/organizations/${orgId}/generated-reports/${reportId}/summary`,
        { method: 'PATCH', body: JSON.stringify({ summary }) },
      ),
    onSuccess: (report) => {
      queryClient.setQueryData<GeneratedReportDto>(
        queryKeys.organizations.generatedReportDetail(orgId, report.id),
        report,
      )
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.organizations.generatedReports(orgId),
      }),
  })
}
