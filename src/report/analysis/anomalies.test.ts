import { describe, expect, test } from 'claude-code/testing'
import type { AgentSnapshot } from '../../core/schema'
import { findAnomalies } from './anomalies'
import { summarizeSession } from './session'
import { CTX, sessionStart, snapshot, spawn, usage, verdict } from './test-fixtures'
import type { EventRecord, Thresholds } from './types'

const THRESHOLDS: Thresholds = { anomalyDelegationCostUsd: 1, anomalyCacheRatioMin: 0.6, anomalyDeniesPerSessionMax: 5 }

const summarize = (events: EventRecord[], snapshots: AgentSnapshot[] = []) => summarizeSession({ events, snapshots }, CTX)
const withAgent = (overrides: Partial<AgentSnapshot>) => summarize([spawn('a1')], [snapshot('a1', overrides)])
const cacheFlags = (figures: ReturnType<typeof summarize>) => findAnomalies([figures], THRESHOLDS).filter((flag) => flag.kind === 'cache-ratio')
const denyEvents = (count: number): EventRecord[] => Array.from({ length: count }, (_, index) => verdict(`t${index}`, 'deny'))

describe('delegation cost', () => {
  test('flags a tree strictly above the threshold with value, threshold and identity', () => {
    const flags = findAnomalies([withAgent({ costUsd: 1.4 })], THRESHOLDS)

    expect(flags).toMatchObject([{ kind: 'delegation-cost', scope: 'tree', sessionId: 's1', rootAgentId: 'a1', subagentType: 'builder', value: 1.4, threshold: 1 }])
  })

  test('a custom higher threshold stops the flag and a cost exactly at the threshold is not flagged', () => {
    expect(findAnomalies([withAgent({ costUsd: 1.4 })], { ...THRESHOLDS, anomalyDelegationCostUsd: 2 })).toEqual([])
    expect(findAnomalies([withAgent({ costUsd: 1 })], THRESHOLDS)).toEqual([])
  })
})

describe('cache ratio volume guard', () => {
  test('skips a low ratio below the prompt volume minimum and evaluates it at the minimum', () => {
    const below = withAgent({ usage: [usage(18000, 0, 1999, 0)] })
    const atMinimum = withAgent({ usage: [usage(18000, 0, 2000, 0)] })

    expect(cacheFlags(below)).toEqual([])
    expect(cacheFlags(atMinimum).map((flag) => flag.scope).sort()).toEqual(['session', 'tree'])
  })

  test('flags a ratio below the minimum with value and threshold, not one exactly at it', () => {
    const low = withAgent({ usage: [usage(30000, 0, 20000, 0)] })
    const exact = withAgent({ usage: [usage(10000, 0, 30000, 10000)] })

    expect(cacheFlags(low).map((flag) => [flag.scope, flag.value, flag.threshold]).sort()).toEqual([
      ['session', 0.4, 0.6],
      ['tree', 0.4, 0.6],
    ])
    expect(cacheFlags(exact)).toEqual([])
  })
})

describe('denies', () => {
  test('flags strictly above the maximum per session', () => {
    expect(findAnomalies([summarize(denyEvents(5))], THRESHOLDS)).toEqual([])
    expect(findAnomalies([summarize(denyEvents(6))], THRESHOLDS)).toMatchObject([{ kind: 'denies', scope: 'session', sessionId: 's1', value: 6, threshold: 5 }])
  })
})

describe('no other signals', () => {
  test('review passes and a null cache ratio raise nothing', () => {
    const reviewers = Array.from({ length: 6 }, (_, index) => spawn(`r${index}`, { subagentType: 'code-reviewer' }))

    expect(findAnomalies([summarize([sessionStart({ harnessProfile: true }), ...reviewers])], THRESHOLDS)).toEqual([])
  })
})
