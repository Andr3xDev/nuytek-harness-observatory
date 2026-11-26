import type { SessionFigures } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { effortLabel } from '../effort'
import { PALETTE } from '../layout'
import { TOKEN_COLUMNS, costColumn, dim, formatCost, gateOf, heading, tableLines, tokenCells, type Column, type Line, type Row, type TabContext } from './common'

const UNKNOWN_MODEL = '?'
const MAIN_LABEL = 'main'
const MODEL_PREFIX = /^claude-/
const MODEL_DATE_SUFFIX = /-\d{8}$/

const NO_EFFORT = '-'
const MAIN_SPAWNS = '—'
// Effort is the first column to go: below wide the row keeps agent and model.
const MODEL_COLUMN: Column = { header: 'Model', width: 12 }
const EFFORT_COLUMN: Column = { header: 'Effort', width: 9, secondary: true, color: cell => (cell === NO_EFFORT ? undefined : PALETTE.effort) }

const TYPE_MODEL_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  MODEL_COLUMN,
  EFFORT_COLUMN,
  { header: 'Spawns', width: 6 },
  ...TOKEN_COLUMNS,
  { header: 'Cost est.', width: 9, color: costColumn },
]

const shortModel = (model: string | null | undefined): string =>
  model ? model.replace(MODEL_PREFIX, '').replace(MODEL_DATE_SUFFIX, '') : UNKNOWN_MODEL

/** The Agent, Model and Effort cells that lead every row. */
const identity = (type: string, model: string | null | undefined, effort?: string | number | null): string[] => [
  type,
  shortModel(model),
  effortLabel(effort) || NO_EFFORT,
]

const RECENT_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  MODEL_COLUMN,
  EFFORT_COLUMN,
  { header: 'Started', width: 11 },
  ...TOKEN_COLUMNS,
  { header: 'Cost est.', width: 9, color: costColumn },
]
const UTC_MINUTE_START = 5
const UTC_MINUTE_END = 16

/** `MM-DD HH:MM` in UTC. */
const formatStarted = (ms: number): string => new Date(ms).toISOString().slice(UTC_MINUTE_START, UTC_MINUTE_END).replace('T', ' ')

const typeModelRows = (aggregate: AggregateFigures): Row[] =>
  aggregate.byTypeModelEffort.map(entry => ({
    cells: [...identity(entry.type, entry.model, entry.effort), `${entry.spawns}×`, ...tokenCells(entry), formatCost(entry)],
  }))

const typeModelLines = ({ tier, columns }: TabContext, aggregate: AggregateFigures): Line[] => [
  heading('By agent type, model and effort'),
  ...tableLines(tier, columns, TYPE_MODEL_COLUMNS, typeModelRows(aggregate)),
]

/** The history tab's agents section: the window's agents by type, model and effort, then its latest runs. */
export function agentHistoryLines(ctx: TabContext, aggregate: AggregateFigures): Line[] {
  const recent = aggregate.recentAgents.map(run => ({
    cells: [...identity(run.type, run.model, run.effort), formatStarted(run.startedAt), ...tokenCells(run), formatCost(run)],
  }))
  const typeModel = typeModelLines(ctx, aggregate)
  return recent.length === 0 ? typeModel : [...typeModel, heading('Recent runs'), ...tableLines(ctx.tier, ctx.columns, RECENT_COLUMNS, recent)]
}

export function agentsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const rows = typeModelRows(gate.aggregate)
  if (ctx.session) {
    const figures = ctx.session.sessionFigures as SessionFigures
    // The host does not expose the main loop's effort, so it stays `-`.
    rows.unshift({
      cells: [...identity(ctx.session.mainAgent ?? MAIN_LABEL, figures.mainModel), MAIN_SPAWNS, ...tokenCells(figures.main), formatCost(figures.main)],
    })
  }
  return [heading('Agents'), ...tableLines(ctx.tier, ctx.columns, TYPE_MODEL_COLUMNS, rows)]
}
