import { describe, expect, test } from 'claude-code/testing'
import { DEFAULT_THRESHOLDS, thresholdsFrom } from './thresholds'

describe('thresholdsFrom', () => {
  test('non-numeric, negative and missing values fall back to 1 / 0.6 / 5', () => {
    expect(thresholdsFrom({})).toEqual(DEFAULT_THRESHOLDS)
    expect(thresholdsFrom({ anomalyDelegationCostUsd: 'x', anomalyCacheRatioMin: -1, anomalyDeniesPerSessionMax: Number.NaN })).toEqual(DEFAULT_THRESHOLDS)
    expect(DEFAULT_THRESHOLDS).toEqual({ anomalyDelegationCostUsd: 1, anomalyCacheRatioMin: 0.6, anomalyDeniesPerSessionMax: 5 })
    expect(thresholdsFrom({ anomalyDelegationCostUsd: 2 }).anomalyDelegationCostUsd).toBe(2)
  })
})
