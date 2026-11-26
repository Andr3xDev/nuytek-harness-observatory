import type { SessionFigures } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { formatTokens } from '../../core/format'
import { effortLabel } from '../effort'
import { PALETTE } from '../layout'
import { costColumn, dim, formatCost, gateOf, heading, tableLines, tokensColumn, type Column, type Line, type Row, type TabContext } from './common'

const UNKNOWN_MODEL = '?'
const MAIN_LABEL = 'main'
const MODEL_PREFIX = /^claude-/
const MODEL_DATE_SUFFIX = /-\d{8}$/

const NO_EFFORT = '-'
// Effort is the first column to go: below wide the row keeps agent and model.
const MODEL_COLUMN: Column = { header: 'Model', width: 12 }
const EFFORT_COLUMN: Column = { header: 'Effort', width: 9, secondary: true, color: cell => (cell === NO_EFFORT ? undefined : PALETTE.effort) }

const TYPE_MODEL_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  MODEL_COLUMN,
  EFFORT_COLUMN,
  { header: 'Spawns', width: 6 },
  { header: 'Tokens', width: 7, color: tokensColumn },
  { header: 'Cost est.', width: 9, color: costColumn },
]
const AGENT_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  MODEL_COLUMN,
  EFFORT_COLUMN,
  { header: 'Tokens', width: 7, color: tokensColumn },
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
  { header: 'Tokens', width: 7, color: tokensColumn },
  { header: 'Cost est.', width: 9, color: costColumn },
]
const UTC_MINUTE_START = 5
const UTC_MINUTE_END = 16

/** `MM-DD HH:MM` in UTC. */
const formatStarted = (ms: number): string => new Date(ms).toISOString().slice(UTC_MINUTE_START, UTC_MINUTE_END).replace('T', ' ')

/**
 * The model that carries most of the main loop's tokens: per model, session tokens minus what the
 * agents ran on it. An agent that switched models counts wholly under its last one, so this is approximate.
 */
function mainModelOf(figures: SessionFigures): string | null {
  const remainder = (model: string, tokens: number): number =>
    tokens - figures.agents.reduce((sum, agent) => (agent.model === model ? sum + agent.tokens : sum), 0)
  let best: { model: string; tokens: number } | null = null
  for (const [model, usage] of Object.entries(figures.byModel)) {
    const tokens = remainder(model, usage.tokens)
    if (tokens > 0 && (best === null || tokens > best.tokens)) best = { model, tokens }
  }
  return best?.model ?? null
}

function typeModelRows(aggregate: AggregateFigures): Row[] {
  return (aggregate.byTypeModelEffort ?? []).map(entry => ({
    cells: [...identity(entry.type, entry.model, entry.effort), `${entry.spawns}×`, formatTokens(Math.round(entry.tokens)), formatCost(entry)],
  }))
}

const recentRows = (aggregate: AggregateFigures): Row[] =>
  (aggregate.recentAgents ?? []).map(run => ({
    cells: [...identity(run.type, run.model, run.effort), formatStarted(run.startedAt), formatTokens(Math.round(run.tokens)), formatCost(run)],
  }))

export function agentsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { tier, columns } = ctx
  const typeModel = [heading('By agent type, model and effort'), ...tableLines(tier, columns, TYPE_MODEL_COLUMNS, typeModelRows(gate.aggregate))]
  if (ctx.scope === 'history') {
    const recent = recentRows(gate.aggregate)
    return recent.length === 0 ? typeModel : [...typeModel, heading('Recent runs'), ...tableLines(tier, columns, RECENT_COLUMNS, recent)]
  }
  if (!ctx.session) return typeModel
  const figures = ctx.session.sessionFigures as SessionFigures
  const main: Row = {
    cells: [...identity(ctx.session.mainAgent ?? MAIN_LABEL, mainModelOf(figures)), formatTokens(figures.main.tokens), formatCost(figures.main)],
  }
  const agents = figures.agents.map(
    (agent): Row => ({
      cells: [...identity(agent.subagentType, agent.model, agent.effort), formatTokens(agent.tokens), formatCost(agent)],
      agentId: agent.agentId,
    }),
  )
  return [heading('Agents'), ...tableLines(tier, columns, AGENT_COLUMNS, [main, ...agents]), ...typeModel]
}
