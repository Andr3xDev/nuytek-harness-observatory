import { cacheRatio } from './issue'
import { CACHE_RATIO_MIN_PROMPT_TOKENS, type Anomaly, type SessionFigures, type Thresholds, type TokenCounts } from './types'

const promptTokensOf = ({ input, cacheRead, cacheCreation }: TokenCounts): number => input + cacheRead + cacheCreation

export function findAnomalies(sessions: readonly SessionFigures[], thresholds: Thresholds): Anomaly[] {
  const anomalies: Anomaly[] = []
  for (const session of sessions) {
    const { sessionId } = session
    for (const tree of session.trees) {
      const identity = { sessionId, rootAgentId: tree.rootAgentId, subagentType: tree.subagentType, issue: tree.issue }
      if (tree.costUsd > thresholds.anomalyDelegationCostUsd) {
        anomalies.push({ kind: 'delegation-cost', scope: 'tree', ...identity, value: tree.costUsd, threshold: thresholds.anomalyDelegationCostUsd })
      }
      const treeRatio = cacheRatio(tree)
      if (treeRatio !== null && tree.promptTokens >= CACHE_RATIO_MIN_PROMPT_TOKENS && treeRatio < thresholds.anomalyCacheRatioMin) {
        anomalies.push({ kind: 'cache-ratio', scope: 'tree', ...identity, value: treeRatio, threshold: thresholds.anomalyCacheRatioMin })
      }
    }
    const sessionRatio = cacheRatio(session.total)
    if (sessionRatio !== null && promptTokensOf(session.total) >= CACHE_RATIO_MIN_PROMPT_TOKENS && sessionRatio < thresholds.anomalyCacheRatioMin) {
      anomalies.push({ kind: 'cache-ratio', scope: 'session', sessionId, value: sessionRatio, threshold: thresholds.anomalyCacheRatioMin })
    }
    if (session.denies > thresholds.anomalyDeniesPerSessionMax) {
      anomalies.push({ kind: 'denies', scope: 'session', sessionId, value: session.denies, threshold: thresholds.anomalyDeniesPerSessionMax })
    }
  }
  return anomalies
}
