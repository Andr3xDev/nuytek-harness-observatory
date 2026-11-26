import type { SessionFigures } from './figures'

export type FigureMode = 'scalar' | 'cell'

const THOUSAND = 1000
const MILLION = 1_000_000
const COMPACT_DECIMALS_LIMIT = 10

const compact = (value: number, suffix: string): string =>
  value < COMPACT_DECIMALS_LIMIT ? `${value.toFixed(1)}${suffix}` : `${Math.round(value)}${suffix}`

export const formatTokens = (tokens: number): string => {
  if (tokens >= MILLION) return compact(tokens / MILLION, 'M')
  if (tokens >= THOUSAND) return compact(tokens / THOUSAND, 'k')
  return String(tokens)
}

const ELLIPSIS = '…'
const ISO_DAY_LENGTH = 'YYYY-MM-DD'.length

export const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}${ELLIPSIS}`

/** UTC calendar day of a timestamp, `YYYY-MM-DD`. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, ISO_DAY_LENGTH)

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`

export const formatFigure = (value: number | null | undefined, mode: FigureMode): string => {
  if (value == null) return mode === 'scalar' ? 'n/a (harness profile off)' : 'n/a'
  return String(value)
}

/** What a band piece means; the panel maps each role to a color so this module stays presentation-free. */
export type BandRole = 'brand' | 'cost' | 'tokens' | 'agents' | 'plain' | 'dim'
export type BandSegment = { text: string; role: BandRole }

export const bandSegments = (figures: Pick<SessionFigures, 'total' | 'agents'>): BandSegment[] => {
  const { total, agents } = figures
  const cost = `${total.hasUnknownPrice ? '~' : ''}${formatUsd(total.costUsd)}`
  return [
    { text: '◆', role: 'brand' },
    { text: ' obs  ', role: 'plain' },
    { text: cost, role: 'cost' },
    { text: ' · ', role: 'dim' },
    { text: '◈', role: 'tokens' },
    { text: ` ${formatTokens(total.tokens)} tok`, role: 'plain' },
    { text: ' · ', role: 'dim' },
    { text: '▸', role: 'agents' },
    { text: ` ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`, role: 'plain' },
  ]
}

export const formatBandLine = (figures: Pick<SessionFigures, 'total' | 'agents'>): string =>
  bandSegments(figures).map(({ text }) => text).join('')
