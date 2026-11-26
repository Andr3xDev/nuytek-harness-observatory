import { DRIFT_ABS_USD, DRIFT_REL } from '../../core/constants'

export type Reading = {
  startedAt: number
  sessionUsd: number
  hasUnknownPrice: boolean
  agents: ReadonlyMap<string, number>
}

const EMPTY_AGENTS: ReadonlyMap<string, number> = new Map()

/** Main-loop cost of one turn: session delta minus subagent deltas over the same window. */
export const computeTurnCost = (
  baseline: Reading | null,
  end: Reading | null,
  lastKnownAgentUsd: ReadonlyMap<string, number>,
): number | null => {
  if (!baseline || !end) return null
  const reset = baseline.startedAt !== end.startedAt
  const startSessionUsd = reset ? 0 : baseline.sessionUsd
  const startAgents = reset ? EMPTY_AGENTS : baseline.agents

  let agentsDelta = 0
  for (const [agentId, usd] of end.agents) agentsDelta += usd - (startAgents.get(agentId) ?? 0)
  for (const [agentId, startUsd] of startAgents) {
    if (!end.agents.has(agentId)) agentsDelta += (lastKnownAgentUsd.get(agentId) ?? startUsd) - startUsd
  }

  const cost = end.sessionUsd - startSessionUsd - agentsDelta
  const tolerance = Math.max(DRIFT_ABS_USD, DRIFT_REL * Math.abs(end.sessionUsd))
  return cost < 0 && cost >= -tolerance ? 0 : cost
}
