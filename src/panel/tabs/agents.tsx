import type { SessionFigures } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { formatTokens } from '../../core/format'
import { costColumn, dim, formatCost, gateOf, heading, tableLines, tokensColumn, type Column, type Line, type Row, type TabContext } from './common'

const UNKNOWN_MODEL = '?'
const MAIN_LABEL = 'main'
const MODEL_PREFIX = /^claude-/
const MODEL_DATE_SUFFIX = /-\d{8}$/

const TYPE_MODEL_COLUMNS: Column[] = [
  { header: 'Agent · model', width: 0 },
  { header: 'Spawns', width: 6 },
  { header: 'Tokens', width: 7, color: tokensColumn },
  { header: 'Cost est.', width: 9, color: costColumn },
]
const AGENT_COLUMNS: Column[] = [
  { header: 'Agent · model', width: 0 },
  { header: 'Tokens', width: 7, color: tokensColumn },
  { header: 'Cost est.', width: 9, color: costColumn },
]

const shortModel = (model: string | null | undefined): string =>
  model ? model.replace(MODEL_PREFIX, '').replace(MODEL_DATE_SUFFIX, '') : UNKNOWN_MODEL

const label = (type: string, model: string | null | undefined): string => `${type} · ${shortModel(model)}`

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
  return aggregate.byTypeModel.map(entry => ({
    cells: [label(entry.type, entry.model), `${entry.spawns}×`, formatTokens(Math.round(entry.tokens)), formatCost(entry)],
  }))
}

export function agentsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { tier, columns } = ctx
  const typeModel = [heading('By agent type and model'), ...tableLines(tier, columns, TYPE_MODEL_COLUMNS, typeModelRows(gate.aggregate))]
  if (ctx.scope !== 'session' || !ctx.session) return typeModel
  const figures = ctx.session.sessionFigures as SessionFigures
  const main: Row = {
    cells: [label(ctx.session.mainAgent ?? MAIN_LABEL, mainModelOf(figures)), formatTokens(figures.main.tokens), formatCost(figures.main)],
  }
  const agents = figures.agents.map(
    (agent): Row => ({
      cells: [label(agent.subagentType, agent.model), formatTokens(agent.tokens), formatCost(agent)],
      agentId: agent.agentId,
    }),
  )
  return [heading('Agents'), ...tableLines(tier, columns, AGENT_COLUMNS, [main, ...agents]), ...typeModel]
}
