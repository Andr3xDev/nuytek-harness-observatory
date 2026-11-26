import { DRIFT_ABS_USD, DRIFT_REL } from '../../core/constants'
import type { DriftReason } from '../../core/schema'

export type ReconcileInput = {
  sessionUsd: number
  hasUnknownPrice: boolean
  agents: ReadonlyArray<{ usd: number; hasUnknownPrice?: boolean }>
  /** Sum of the four token fields over the main-loop ledger. */
  mainTokens: number
}

export type ReconcileResult = {
  sumAgentsUsd: number
  sessionUsd: number
  mainResidualUsd: number
  mainTokens: number
  drifted: boolean
  driftReasons: DriftReason[]
}

export const reconcile = (input: ReconcileInput): ReconcileResult => {
  const { sessionUsd, mainTokens } = input
  const sumAgentsUsd = input.agents.reduce((sum, agent) => sum + agent.usd, 0)
  const mainResidualUsd = sessionUsd - sumAgentsUsd
  const tolerance = Math.max(DRIFT_ABS_USD, DRIFT_REL * Math.abs(sessionUsd))

  const driftReasons: DriftReason[] = []
  if (sumAgentsUsd - sessionUsd > tolerance) driftReasons.push('agents-exceed-session')
  if (input.hasUnknownPrice || input.agents.some((agent) => agent.hasUnknownPrice)) driftReasons.push('unknown-price')
  if (mainTokens > 0 && mainResidualUsd <= tolerance) driftReasons.push('main-cost-missing')

  return { sumAgentsUsd, sessionUsd, mainResidualUsd, mainTokens, drifted: driftReasons.length > 0, driftReasons }
}
