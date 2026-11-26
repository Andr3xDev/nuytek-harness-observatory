import { formatTokens, formatUsd, isoDay, truncate } from '../core/format'
import type { AggregateFigures, Anomaly } from './analysis/types'

export const REPORT_TOP_AGENT_TYPES = 8
export const REPORT_TOP_MODELS = 5
export const REPORT_TOP_ISSUES = 10
export const REPORT_MAX_ANOMALIES = 8
export const DEFAULT_COLUMNS = 80

const NO_DATA_TEXT = 'No sessions recorded yet.'
const PROFILE_OFF_TEXT = 'Profile: n/a (harness profile off)'
const PERCENT = 100

const percent = (ratio: number | null): string => (ratio === null ? 'n/a' : `${Math.round(ratio * PERCENT)}%`)
const money = (costUsd: number, hasUnknownPrice: boolean): string => `${hasUnknownPrice ? '~' : ''}${formatUsd(costUsd)}`
const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`

const collapse = <T>(rows: readonly T[], limit: number, render: (row: T) => string): string[] => {
  const lines = rows.slice(0, limit).map(render)
  return rows.length > limit ? [...lines, `  +${rows.length - limit} more`] : lines
}

/** How far past its threshold a flag is, so cost, ratio and deny flags sort on one scale. */
const severityOf = ({ kind, value, threshold }: Anomaly): number => (kind === 'cache-ratio' ? (value > 0 ? threshold / value : Infinity) : threshold > 0 ? value / threshold : Infinity)

const anomalyLine = (anomaly: Anomaly): string => {
  const where = anomaly.scope === 'tree' ? `tree ${anomaly.subagentType ?? '?'} ${anomaly.issue ?? ''}`.trim() : 'session'
  const measure =
    anomaly.kind === 'delegation-cost'
      ? `cost ${formatUsd(anomaly.value)} > ${formatUsd(anomaly.threshold)}`
      : anomaly.kind === 'cache-ratio'
        ? `cache ${percent(anomaly.value)} < ${percent(anomaly.threshold)}`
        : `denies ${anomaly.value} > ${anomaly.threshold}`
  return `  ! ${where} ${anomaly.sessionId}: ${measure}`
}

const profileLines = (profile: NonNullable<AggregateFigures['profile']>): string[] => {
  const { sessions, profileSessions } = profile.coverage
  const sum = (counts: Record<string, number>): number => Object.values(counts).reduce((total, count) => total + count, 0)
  return [
    profileSessions < sessions ? `Profile (${profileSessions} of ${sessions} sessions)` : 'Profile',
    `  review passes ${profile.reviewPasses} · re-routes ${sum(profile.reroutesByType)}`,
    `  skills injected ${sum(profile.skillsInjected)} · guards ${sum(profile.guards)}`,
  ]
}

export function formatReport(aggregate: AggregateFigures, anomalies: readonly Anomaly[], columns: number = DEFAULT_COLUMNS): string {
  if (aggregate.sessions === 0) return truncate(NO_DATA_TEXT, columns)
  const { total } = aggregate
  const window = aggregate.windowStart !== null && aggregate.windowEnd !== null ? ` · ${isoDay(aggregate.windowStart)} to ${isoDay(aggregate.windowEnd)}` : ''
  const open = aggregate.openSessions > 0 ? ` (${aggregate.openSessions} open)` : ''
  const flagged = [...anomalies].sort((left, right) => severityOf(right) - severityOf(left))

  const lines = [
    `Observability report${window}`,
    '',
    'Totals',
    `  ${formatTokens(total.tokens)} tokens · ${money(total.costUsd, total.hasUnknownPrice)} est. · cache ${percent(aggregate.cacheRatio)} · ${plural(aggregate.sessions, 'session')}${open}`,
    '',
    'Agent types',
    ...collapse(aggregate.byType, REPORT_TOP_AGENT_TYPES, (row) => `  ${row.type} · ${plural(row.spawns, 'spawn')} (${percent(row.spawnShare)}) · ${formatTokens(row.tokens)} tok (${percent(row.tokenShare)})`),
    '',
    'Models (tokens only)',
    ...collapse(aggregate.byModel, REPORT_TOP_MODELS, (row) => `  ${row.model} · ${formatTokens(row.tokens)} tok`),
    '',
    'Issues by cost',
    ...collapse(aggregate.byIssue, REPORT_TOP_ISSUES, (row) => `  ${row.issue} · ${money(row.costUsd, row.hasUnknownPrice)} est. · ${formatTokens(row.tokens)} tok`),
    '',
    ...(aggregate.profile ? profileLines(aggregate.profile) : [PROFILE_OFF_TEXT]),
    '',
    'Anomalies',
    ...(flagged.length === 0 ? ['  none found'] : collapse(flagged, REPORT_MAX_ANOMALIES, anomalyLine)),
    '',
    'Costs are estimates; ~ marks a total with an unknown price.',
  ]
  return lines.map((line) => truncate(line, columns)).join('\n')
}
