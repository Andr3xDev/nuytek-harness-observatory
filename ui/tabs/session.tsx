import type { AgentFigures, AggregateFigures, Figure, SessionFigures } from '../../aggregates'
import type { SessionAtom } from '../../types'
import { formatTokens } from '../format'
import {
  ESTIMATE_FOOTNOTE,
  dim,
  formatCost,
  gateOf,
  heading,
  tableLines,
  type Column,
  type Line,
  type Row,
  type TabContext,
} from './common'

const TREE_COLUMNS: Column[] = [{ header: 'Name', width: 0 },{ header: 'Status', width: 9, narrowHidden: true }, { header: 'Tokens', width: 7 }, { header: 'Cost est.', width: 9 }]
const TYPE_COLUMNS: Column[] = [{ header: 'Type', width: 0 }, { header: 'Spawns', width: 6 }, { header: 'Tokens', width: 7 }, { header: 'Cost est.', width: 9 }]
const MODEL_COLUMNS: Column[] = [{ header: 'Model', width: 0 }, { header: 'Tokens', width: 7 }]
const ISSUE_COLUMNS: Column[] = [{ header: 'Issue', width: 0 }, { header: 'Tokens', width: 7 }, { header: 'Cost est.', width: 9 }]
const INDENT = '  '

const totalsLine = (total: Figure): Line => ({ text: `Tokens: ${formatTokens(total.tokens)} · Cost (est.): ${formatCost(total)}` })

const figureRow = (name: string, status: string, figure: Figure, agentId?: string): Row => ({
  cells: [name, status, formatTokens(figure.tokens), formatCost(figure)],
  agentId,
})

// Roots are agents without a known parent; a visited set keeps a bad parent link from looping.
function treeRows(agents: readonly AgentFigures[]): Row[] {
  const ids = new Set(agents.map(agent => agent.agentId))
  const children = new Map<string | null, AgentFigures[]>()
  for (const agent of agents) {
    const parent = agent.parentAgentId !== null && ids.has(agent.parentAgentId) ? agent.parentAgentId : null
    children.set(parent, [...(children.get(parent) ?? []), agent])
  }
  const rows: Row[] = []
  const visited = new Set<string>()
  const walk = (parent: string | null, depth: number): void => {
    for (const agent of children.get(parent) ?? []) {
      if (visited.has(agent.agentId)) continue
      visited.add(agent.agentId)
      rows.push(figureRow(`${INDENT.repeat(depth)}${agent.subagentType}`, agent.engineStatus, agent, agent.agentId))
      walk(agent.agentId, depth + 1)
    }
  }
  walk(null, 1)
  return rows
}

const contextLine = (context: SessionAtom['context']): Line => ({
  text: context?.percent == null ? 'Context: n/a' : `Context: ${context.percent}% of ${formatTokens(context.window)}`,
})

function sessionScopeLines(ctx: TabContext, figures: SessionFigures, context: SessionAtom['context']): Line[] {
  const { tier, columns } = ctx
  const models = Object.entries(figures.byModel).map(([model, usage]): Row => ({ cells: [model, formatTokens(usage.tokens)] }))
  const lines: Line[] = [
    totalsLine(figures.total),
    contextLine(context),
    { text: `Agents: ${figures.agents.length}` },
    heading('Agent tree'),
    ...tableLines(tier, columns, TREE_COLUMNS, [figureRow('main', '-', figures.main), ...treeRows(figures.agents)]),
    heading('Usage by model'),
    ...tableLines(tier, columns, MODEL_COLUMNS, models),
  ]
  return figures.total.hasUnknownPrice ? [...lines, dim(ESTIMATE_FOOTNOTE)] : lines
}

const formatDay = (ms: number | null): string => (ms === null ? '-' : new Date(ms).toISOString().slice(0, 10))

function historyScopeLines(ctx: TabContext, aggregate: AggregateFigures): Line[] {
  const { tier, columns } = ctx
  const byType = aggregate.byType.map(
    (entry): Row => ({ cells: [entry.type, String(entry.spawns), formatTokens(entry.tokens), formatCost(entry)] }),
  )
  const byModel = aggregate.byModel.map((entry): Row => ({ cells: [entry.model, formatTokens(entry.tokens)] }))
  const byIssue = [...aggregate.byIssue]
    .sort((left, right) => right.tokens - left.tokens)
    .map((entry): Row => ({ cells: [entry.issue, formatTokens(entry.tokens), formatCost(entry)] }))
  const lines: Line[] = [
    totalsLine(aggregate.total),
    { text: `Sessions: ${aggregate.sessions} · ${formatDay(aggregate.windowStart)} to ${formatDay(aggregate.windowEnd)}` },
    heading('By agent type'),
    ...tableLines(tier, columns, TYPE_COLUMNS, byType),
    heading('Usage by model'),
    ...tableLines(tier, columns, MODEL_COLUMNS, byModel),
    heading('Top issues'),
    ...tableLines(tier, columns, ISSUE_COLUMNS, byIssue),
  ]
  return aggregate.total.hasUnknownPrice ? [...lines, dim(ESTIMATE_FOOTNOTE)] : lines
}

export function sessionLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  if (ctx.scope === 'history' || !ctx.session) return historyScopeLines(ctx, gate.aggregate)
  return sessionScopeLines(ctx, ctx.session.sessionFigures as SessionFigures, ctx.session.context)
}
