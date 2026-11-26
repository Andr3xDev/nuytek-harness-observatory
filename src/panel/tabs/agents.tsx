import type { AggregateFigures, SessionFigures } from '../../report/analysis'
import { formatFigure } from '../../core/format'
import {
  PROFILE_OFF_FOOTNOTE,
  dim,
  formatDuration,
  formatPercent,
  formatTokenCount,
  gateOf,
  heading,
  tableLines,
  type Column,
  type Line,
  type Row,
  type TabContext,
} from './common'

const TYPE_COLUMNS: Column[] = [
  { header: 'Type', width: 0 },
  { header: 'Spawns', width: 6 },
  { header: 'Share', width: 5 },
  { header: 'Avg tok', width: 7, secondary: true },
  { header: 'Time', width: 6, secondary: true },
  { header: 'Status mix', width: 25 },
  { header: 'Reroutes', width: 8 },
]
const AGENT_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  { header: 'Status', width: 9 },
  { header: 'Tokens', width: 7 },
  { header: 'Time', width: 6, secondary: true },
]

function typeRows(aggregate: AggregateFigures): Row[] {
  const { profile } = aggregate
  return aggregate.byType.map(entry => {
    const mix = profile ? (profile.statusMixByType[entry.type] ?? {}) : null
    const statusMix = mix ? `${mix.done ?? 0} done ${mix.blocked ?? 0} blocked ${mix.partial ?? 0} partial` : formatFigure(null, 'cell')
    const reroutes = profile ? String(profile.reroutesByType[entry.type] ?? 0) : formatFigure(null, 'cell')
    return {
      cells: [
        entry.type,
        String(entry.spawns),
        formatPercent(entry.tokenShare),
        entry.avgTokens === null ? '-' : formatTokenCount(entry.avgTokens),
        entry.avgDurationMs === null ? '-' : formatDuration(entry.avgDurationMs),
        statusMix,
        reroutes,
      ],
    }
  })
}

export function agentsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { aggregate } = gate
  const { tier, columns } = ctx
  const rows = typeRows(aggregate)
  const lines: Line[] = [
    { text: `Review rounds: ${aggregate.profile ? aggregate.profile.reviewPasses : formatFigure(null, 'scalar')}` },
    heading('By agent type'),
    ...tableLines(tier, columns, TYPE_COLUMNS, rows),
  ]
  if (ctx.scope === 'session' && ctx.session) {
    const agents = (ctx.session.sessionFigures as SessionFigures).agents.map(
      (agent): Row => ({
        cells: [agent.subagentType, agent.engineStatus, formatTokenCount(agent.tokens), formatDuration(agent.durationMs)],
        agentId: agent.agentId,
      }),
    )
    lines.push(heading('Agents'), ...tableLines(tier, columns, AGENT_COLUMNS, agents))
  }
  return aggregate.profile === null && rows.length > 0 ? [...lines, dim(PROFILE_OFF_FOOTNOTE)] : lines
}
