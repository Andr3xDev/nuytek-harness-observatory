import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import type { EventRecord } from './types'
import { CTX, mainSnapshot, sessionEnd, sessionStart, turn, usage } from './test-fixtures'

const TEN_TOKENS = usage(10, 0, 0, 0)

describe('main loop cost source', () => {
  const lagging = turn(null, { usage: TEN_TOKENS, costUsd: 0.75 })
  const snapshots = [mainSnapshot({ usage: [TEN_TOKENS], costUsd: 0.5 })]

  test('a turn cost above the snapshot cost wins, stored or still pending', () => {
    expect(summarizeSession({ events: [lagging], snapshots }, CTX).main.costUsd).toBe(0.75)
    expect(summarizeSession({ events: [], snapshots, pendingEvents: [lagging] }, CTX).main.costUsd).toBe(0.75)
  })

  test('a turn sum above the snapshot cost by float noise keeps the snapshot source', () => {
    const figures = summarizeSession({ events: [turn(null, { usage: TEN_TOKENS, costUsd: 0.5 + 1e-12 })], snapshots }, CTX)

    expect(figures.main.costUsd).toBe(0.5)
  })

  test('a session.measure with an unknown price flags the estimate', () => {
    const measure = { ...sessionEnd(), type: 'session.measure', costUsd: 0, hasUnknownPrice: true, context: null, rateLimits: null } as unknown as EventRecord
    const figures = summarizeSession({ events: [measure, turn(null, { usage: TEN_TOKENS, costUsd: 0.25 })], snapshots: [] }, CTX)

    expect(figures.total.hasUnknownPrice).toBe(true)
  })
})

describe('lastEventAt', () => {
  test('is the latest event timestamp, open sessions included', () => {
    const figures = summarizeSession({ events: [sessionStart({ ts: 10 }), turn(null, { ts: 40 })], snapshots: [] }, CTX)

    expect(figures.lastEventAt).toBe(40)
  })

  test('survives a very large event log', () => {
    const count = 100_000
    const events = Array.from({ length: count }, (_, index) => ({ id: `e${index}`, ts: index }) as unknown as EventRecord)
    const figures = summarizeSession({ events, snapshots: [] }, CTX)

    expect(figures.lastEventAt).toBe(count - 1)
  })
})
