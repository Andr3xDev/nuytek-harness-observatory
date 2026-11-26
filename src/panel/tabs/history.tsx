import { agentHistoryLines } from './agents'
import { dim, historyGateOf, type Line, type TabContext } from './common'
import { historyOverviewLines } from './session'

export function historyLines(ctx: TabContext): Line[] {
  const gate = historyGateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  return [...historyOverviewLines(ctx, gate.aggregate), ...agentHistoryLines(ctx, gate.aggregate)]
}
