import type { Elements, RenderSurface } from 'claude-code'
import type { HistoryAtom, PanelScope, SessionAtom } from '../../../types'
import type { Figure } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { formatTokens, formatUsd, truncate } from '../../core/format'
import { LIST_ROW_CAP, capRows, formatRow, type Tier } from '../layout'

export type Kit = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

/** One drawn row. `text` may span lines (narrow two-line rows). */
export type Line = { text: string; dim?: boolean; heading?: boolean; agentId?: string }

export type TabContext = { tier: Tier; columns: number; scope: PanelScope; session: SessionAtom | null; history: HistoryAtom }

/** `secondary` columns drop below wide; `narrowHidden` ones drop on narrow only. */
export type Column = { header: string; width: number; secondary?: true; narrowHidden?: true }
export type Row = { cells: string[]; agentId?: string }

export const PROFILE_OFF_FOOTNOTE = 'n/a: harness profile off'
export const ESTIMATE_FOOTNOTE = '~ estimate: price unknown for some usage'
const MIN_NAME_WIDTH = 6
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const PERCENT = 100
const NARROW_INDENT = '  '

export const dim = (text: string): Line => ({ text, dim: true })
export const heading = (text: string): Line => ({ text, heading: true })

export const formatCost = (figure: Pick<Figure, 'costUsd' | 'hasUnknownPrice'>): string =>
  `${figure.hasUnknownPrice ? '~' : ''}${formatUsd(figure.costUsd)}`

export const formatPercent = (fraction: number | null): string => (fraction === null ? '-' : `${Math.round(fraction * PERCENT)}%`)

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / MS_PER_SECOND)
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m${seconds % SECONDS_PER_MINUTE}s`
}

export const formatTokenCount = (tokens: number): string => formatTokens(Math.round(tokens))

export function capLines(lines: readonly Line[], cap: number): Line[] {
  const capped = capRows(lines.map(line => line.text), cap)
  return capped.length > cap ? [...lines.slice(0, cap), dim(capped[cap] ?? '')] : [...lines]
}

/**
 * Wide and medium: aligned columns, name takes the rest. Narrow: name, then the other
 * values on one indented line. Secondary columns are dropped below wide.
 */
export function tableLines(tier: Tier, columns: number, spec: readonly Column[], rows: readonly Row[], cap = LIST_ROW_CAP): Line[] {
  const keep = spec.map(column => !(column.secondary && tier !== 'wide') && !(column.narrowHidden && tier === 'narrow'))
  const visible = <T,>(items: readonly T[]): T[] => items.filter((_, index) => keep[index])
  const shown = visible(spec)
  if (tier === 'narrow') {
    return capLines(
      rows.map(({ cells, agentId }) => {
        const [name = '', ...rest] = visible(cells)
        return { text: `${truncate(name, columns)}\n${NARROW_INDENT}${rest.join(' · ')}`, agentId }
      }),
      cap,
    )
  }
  const fixed = shown.slice(1).map(column => column.width)
  const nameWidth = Math.max(columns - fixed.reduce((sum, width) => sum + width, 0) - fixed.length, MIN_NAME_WIDTH)
  const widths = [nameWidth, ...fixed]
  return [
    dim(formatRow(shown.map(column => column.header), widths)),
    ...capLines(rows.map(({ cells, agentId }) => ({ text: formatRow(visible(cells), widths), agentId })), cap),
  ]
}

export type Gate = { aggregate: AggregateFigures } | { message: string }

/** The aggregate behind a tab for its scope, or the one line to show instead of it. */
export function gateOf({ scope, session, history }: TabContext): Gate {
  if (scope === 'history') {
    if (history.status === 'ready' && history.aggregate) return { aggregate: history.aggregate as AggregateFigures }
    if (history.status === 'unavailable') return { message: `History unavailable: ${history.reason ?? 'unknown reason'}` }
    return { message: 'Loading history...' }
  }
  return session ? { aggregate: session.aggregate as AggregateFigures } : { message: 'Waiting for session data...' }
}

export function renderLines(kit: Kit, lines: readonly Line[], liveAgentIds: readonly string[], onViewAgent: (agentId: string) => Promise<unknown>) {
  const { Text, Button } = kit
  return lines.map((line, index) => {
    const { agentId } = line
    if (agentId !== undefined && liveAgentIds.includes(agentId)) {
      return (
        <Button key={`agent:${agentId}`} plain onPress={() => onViewAgent(agentId)}>
          {line.text}
        </Button>
      )
    }
    return (
      <Text key={`line:${index}`} bold={line.heading} dimColor={line.dim} wrap="wrap">
        {line.text}
      </Text>
    )
  })
}
