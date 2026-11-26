import type { PluginOptions } from 'claude-code'
import { findAnomalies } from './analysis/anomalies'
import { combineSessions } from './analysis/combine'
import { DEFAULT_COLUMNS, formatReport } from './format'
import { loadHistory, type HistoryDeps } from './load-history'
import { thresholdsFrom } from './thresholds'

export type ReportDeps = HistoryDeps & { options: PluginOptions; now: number; columns?: number }

/** Display-only on purpose: no `context`, so the model never reads the report. */
export async function handleReport({ options, now, columns, ...history }: ReportDeps): Promise<{ text: string; isTextDisplayOnly: true }> {
  const { sessions } = await loadHistory(history, { now })
  const text = formatReport(combineSessions(sessions), findAnomalies(sessions, thresholdsFrom(options)), columns ?? DEFAULT_COLUMNS)
  return { text, isTextDisplayOnly: true }
}
