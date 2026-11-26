import type { Color, Elements, RenderSurface } from 'claude-code'
import type { HistoryAtom, SessionAtom } from '../../../types'
import type { Figure, TokenCounts } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { formatTokens, formatUsd, truncate } from '../../core/format'
import { COLUMN_SEPARATOR, LIST_ROW_CAP, PALETTE, SECTION_RULE, capRows, formatRow, type Tier } from '../layout'

export type Kit = Pick<Elements[RenderSurface], 'Box' | 'Text' | 'Button'>

/**
 * One drawn row. `text` may span lines (narrow two-line rows). `styles` colors the cells of a
 * `COLUMN_SEPARATOR`-joined `text`, by position.
 */
export type Line = { text: string; dim?: boolean; heading?: boolean; agentId?: string; styles?: (Color | undefined)[] }

export type TabContext = { tier: Tier; columns: number; session: SessionAtom | null; history: HistoryAtom }

/** `secondary` columns drop below wide; `narrowHidden` ones drop on narrow only. `color` may depend on the cell. */
export type Column = {
  header: string
  width: number
  secondary?: true
  narrowHidden?: true
  color?: Color | ((cell: string) => Color | undefined)
}
export type Row = { cells: string[]; agentId?: string }

export const PROFILE_OFF_FOOTNOTE = 'n/a: harness profile off'
export const ESTIMATE_FOOTNOTE = '~ estimate: price unknown for some usage'
const MIN_NAME_WIDTH = 6
// The full-width band would otherwise spread a few short rows across the whole terminal.
const MAX_NAME_WIDTH = 40
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const PERCENT = 100
const NARROW_INDENT = '  '

export const dim = (text: string): Line => ({ text, dim: true })
export const heading = (text: string): Line => ({ text, heading: true })

/** Column colors shared by every tab, so a figure looks the same wherever it appears. */
export const tokensColumn = PALETTE.tokens
export const costColumn = PALETTE.cost
/** Counts of things that went wrong: a zero is not worth a warning color. */
export const failureColumn = (cell: string): Color | undefined => (cell === '0' || cell === '-' ? undefined : PALETTE.failure)
export const statusColumn = (cell: string): Color | undefined => (cell === 'failed' ? PALETTE.failure : undefined)

const colorOf = (column: Column, cell: string): Color | undefined => (typeof column.color === 'function' ? column.color(cell) : column.color)

const TOKEN_COLUMN_WIDTH = 7
/** Input, output and total: In and Out are secondary, so narrow rows keep only the total. */
export const TOKEN_COLUMNS: Column[] = [
  { header: 'In', width: TOKEN_COLUMN_WIDTH, secondary: true, color: tokensColumn },
  { header: 'Out', width: TOKEN_COLUMN_WIDTH, secondary: true, color: tokensColumn },
  { header: 'Total', width: TOKEN_COLUMN_WIDTH, color: tokensColumn },
]

/** Input counts the cached prompt tokens too, so In + Out is the total. */
export const promptTokensOf = (figure: TokenCounts): number => figure.input + figure.cacheRead + figure.cacheCreation

export const formatCost =(figure: Pick<Figure, 'costUsd' | 'hasUnknownPrice'>): string =>
  `${figure.hasUnknownPrice ? '~' : ''}${formatUsd(figure.costUsd)}`

export const formatPercent = (fraction: number | null): string => (fraction === null ? '-' : `${Math.round(fraction * PERCENT)}%`)

export const formatDuration = (ms: number): string => {
  const seconds = Math.round(ms / MS_PER_SECOND)
  return seconds < SECONDS_PER_MINUTE ? `${seconds}s` : `${Math.floor(seconds / SECONDS_PER_MINUTE)}m${seconds % SECONDS_PER_MINUTE}s`
}

export const formatTokenCount = (tokens: number): string => formatTokens(Math.round(tokens))

/** The In, Out and Total cells matching `TOKEN_COLUMNS`. */
export const tokenCells = (figure: TokenCounts & { tokens: number }): string[] => [
  formatTokenCount(promptTokensOf(figure)),
  formatTokenCount(figure.output),
  formatTokenCount(figure.tokens),
]

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
  const nameWidth = Math.min(
    Math.max(columns - fixed.reduce((sum, width) => sum + width, 0) - fixed.length * COLUMN_SEPARATOR.length, MIN_NAME_WIDTH),
    MAX_NAME_WIDTH,
  )
  const widths = [nameWidth, ...fixed]
  return [
    dim(formatRow(shown.map(column => column.header), widths, COLUMN_SEPARATOR)),
    ...capLines(
      rows.map(({ cells, agentId }) => {
        const shownCells = visible(cells)
        return {
          text: formatRow(shownCells, widths, COLUMN_SEPARATOR),
          styles: shown.map((column, index) => colorOf(column, shownCells[index] ?? '')),
          agentId,
        }
      }),
      cap,
    ),
  ]
}

export type Gate = { aggregate: AggregateFigures } | { message: string }

/** The current session's aggregate, or the one line to show instead of it. */
export const gateOf = ({ session }: TabContext): Gate =>
  session ? { aggregate: session.aggregate as AggregateFigures } : { message: 'Waiting for session data...' }

/** The history window's aggregate, or the one line to show instead of it. */
export function historyGateOf({ history }: TabContext): Gate {
  if (history.status === 'ready' && history.aggregate) return { aggregate: history.aggregate as AggregateFigures }
  if (history.status === 'unavailable') return { message: `History unavailable: ${history.reason ?? 'unknown reason'}` }
  return { message: 'Loading history...' }
}

export function renderLines(
  kit: Kit,
  lines: readonly Line[],
  liveAgentIds: readonly string[],
  onViewAgent: (agentId: string) => Promise<unknown>,
  columns: number,
) {
  const { Text, Button } = kit
  // Cells are colored and the column dividers drawn dim; a text without a divider is one plain piece.
  const pieces = ({ text, styles }: Line) =>
    text.split(COLUMN_SEPARATOR).flatMap((cell, index) => [
      ...(index > 0 ? [<Text key={`sep:${index}`} dimColor>{COLUMN_SEPARATOR}</Text>] : []),
      <Text key={`cell:${index}`} color={styles?.[index]}>{cell}</Text>,
    ])
  return lines.flatMap((line, index) => {
    const { agentId } = line
    const rule = line.heading && index > 0 ? [<Text key={`rule:${index}`} dimColor wrap="truncate-end">{SECTION_RULE.repeat(columns)}</Text>] : []
    if (agentId !== undefined && liveAgentIds.includes(agentId)) {
      return [
        ...rule,
        <Button key={`agent:${agentId}`} plain onPress={() => onViewAgent(agentId)}>
          {pieces(line)}
        </Button>,
      ]
    }
    return [
      ...rule,
      <Text key={`line:${index}`} bold={line.heading} color={line.heading ? PALETTE.heading : undefined} dimColor={line.dim} wrap="wrap">
        {pieces(line)}
      </Text>,
    ]
  })
}
