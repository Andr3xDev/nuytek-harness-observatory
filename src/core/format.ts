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

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`

export const formatFigure = (value: number | null | undefined, mode: FigureMode): string => {
  if (value == null) return mode === 'scalar' ? 'n/a (harness profile off)' : 'n/a'
  return String(value)
}

export const formatBandLine = (figures: Pick<SessionFigures, 'total' | 'agents'>): string => {
  const { total, agents } = figures
  const cost = `${total.hasUnknownPrice ? '~' : ''}${formatUsd(total.costUsd)}`
  return `obs ${cost} · ${formatTokens(total.tokens)} tok · ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}`
}
