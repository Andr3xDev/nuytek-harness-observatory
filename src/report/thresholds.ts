import type { PluginOptions } from 'claude-code'
import type { Thresholds } from './analysis/types'

export const DEFAULT_THRESHOLDS: Thresholds = { anomalyDelegationCostUsd: 1, anomalyCacheRatioMin: 0.6, anomalyDeniesPerSessionMax: 5 }

const asThreshold = (value: unknown, fallback: number): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback)

export const thresholdsFrom = (options: PluginOptions): Thresholds => ({
  anomalyDelegationCostUsd: asThreshold(options.anomalyDelegationCostUsd, DEFAULT_THRESHOLDS.anomalyDelegationCostUsd),
  anomalyCacheRatioMin: asThreshold(options.anomalyCacheRatioMin, DEFAULT_THRESHOLDS.anomalyCacheRatioMin),
  anomalyDeniesPerSessionMax: asThreshold(options.anomalyDeniesPerSessionMax, DEFAULT_THRESHOLDS.anomalyDeniesPerSessionMax),
})
