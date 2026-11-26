import type { SessionFigures } from '../../core/figures'
import type { AggregateFigures } from '../../report/analysis'
import { formatTokens } from '../../core/format'
import { costColumn, dim, formatCost, gateOf, heading, tableLines, tokensColumn, type Column, type Line, type Row, type TabContext } from './common'

const UNKNOWN_MODEL = '?'
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

function typeModelRows(aggregate: AggregateFigures): Row[] {
  return aggregate.byTypeModel.map(entry => ({
    cells: [label(entry.type, entry.model), `${entry.spawns}×`, formatTokens(Math.round(entry.tokens)), formatCost(entry)],
  }))
}

export function agentsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { tier, columns } = ctx
  const lines: Line[] = [heading('By agent type and model'), ...tableLines(tier, columns, TYPE_MODEL_COLUMNS, typeModelRows(gate.aggregate))]
  if (ctx.scope === 'session' && ctx.session) {
    const agents = (ctx.session.sessionFigures as SessionFigures).agents.map(
      (agent): Row => ({
        cells: [label(agent.subagentType, agent.model), formatTokens(agent.tokens), formatCost(agent)],
        agentId: agent.agentId,
      }),
    )
    lines.push(heading('Agents'), ...tableLines(tier, columns, AGENT_COLUMNS, agents))
  }
  return lines
}
