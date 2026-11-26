import { describe, expect, test } from 'claude-code/testing'
import { mergeLiveEvents } from './live'
import { summarizeSession } from './session'
import type { LiveAgent } from './types'
import { CTX, HOUR_MS, NOW, mainSnapshot, report, sessionStart, snapshot, spawn, turn, usage, verdict } from './test-fixtures'

const SNAPSHOT_USAGE = usage(10, 0, 0, 0)
const LIVE_USAGE = usage(50, 0, 0, 0)

const liveAgent = (agentId: string, overrides: Partial<LiveAgent> = {}): LiveAgent => ({
  agentId,
  usage: [LIVE_USAGE],
  costUsd: 0.5,
  ...overrides,
})

describe('mergeLiveEvents', () => {
  test('counts an overlapping id once and keeps the stored copy', () => {
    const stored = sessionStart({ id: 'dup', ts: 1 })
    const pendingCopy = { ...stored, ts: 999 }
    const fresh = turn(null)

    const merged = mergeLiveEvents([stored], [pendingCopy, fresh])

    expect(merged).toEqual([stored, fresh])
  })

  test('drops a duplicate id inside the stored events, keeping the first', () => {
    const first = turn(null, { id: 'dup', ts: 1 })
    const retried = { ...first, ts: 2 }

    expect(mergeLiveEvents([first, retried], [])).toEqual([first])
  })

  test('returns the stored events when nothing is pending', () => {
    const stored = [sessionStart(), turn(null)]

    expect(mergeLiveEvents(stored, [])).toEqual(stored)
  })
})

describe('summarizeSession live merge', () => {
  test('counts a turn.complete duplicated in the stored events once', () => {
    const once = turn(null, { id: 'dup', usage: usage(7, 0, 0, 0), costUsd: 0.5 })

    const figures = summarizeSession({ events: [sessionStart(), once, { ...once }], snapshots: [] }, CTX)

    expect(figures.main.input).toBe(7)
    expect(figures.main.costUsd).toBe(0.5)
  })

  test('includes an unflushed deny verdict in the denies figure', () => {
    const figures = summarizeSession({ events: [sessionStart()], snapshots: [], pendingEvents: [verdict('t1', 'deny')] }, CTX)

    expect(figures.denies).toBe(1)
  })

  test('empty or absent pendingEvents give the same figures as stored only', () => {
    const base = { events: [sessionStart(), spawn('a1')], snapshots: [snapshot('a1', { usage: [SNAPSHOT_USAGE], costUsd: 0.25 })] }

    const stored = summarizeSession(base, CTX)

    expect(summarizeSession({ ...base, pendingEvents: [] }, CTX)).toEqual(stored)
  })

  test('is open with pending events and no session.end even when the source file is idle past the cutoff', () => {
    const idleCtx = { now: NOW, sourceMtimeMs: NOW - 10 * HOUR_MS }

    const figures = summarizeSession({ events: [sessionStart()], snapshots: [], pendingEvents: [turn(null)] }, idleCtx)

    expect(figures.state).toBe('open')
  })
})

describe('summarizeSession live main cost', () => {
  test('uses the turn cost sum when pending turns exceed a lagging snapshot, with no gap', () => {
    const figures = summarizeSession(
      {
        events: [],
        snapshots: [mainSnapshot({ costUsd: 0.5 })],
        pendingEvents: [turn(null, { costUsd: 0.75 })],
      },
      CTX,
    )

    expect(figures.main.costUsd).toBe(0.75)
    expect(figures.coverage.mainCostGapUsd).toBe(0)
  })

  test('a stored-only session keeps the snapshot cost and puts the excess in unattributed', () => {
    const figures = summarizeSession(
      { events: [turn(null, { branch: 'feature/io-1-x', costUsd: 0.25 })], snapshots: [mainSnapshot({ costUsd: 0.5 })] },
      CTX,
    )

    expect(figures.main.costUsd).toBe(0.5)
    expect(figures.byIssue.unattributed?.costUsd).toBe(0.25)
  })
})

describe('summarizeSession live agent overlay', () => {
  const events = [spawn('a1')]
  const stored = [snapshot('a1', { usage: [SNAPSHOT_USAGE], costUsd: 0.25 })]

  test('a running agent shows the host usage and cost', () => {
    const figures = summarizeSession({ events, snapshots: stored, liveAgents: [liveAgent('a1')] }, CTX)

    expect(figures.agents[0]).toMatchObject({ agentId: 'a1', tokens: 50, costUsd: 0.5 })
    expect(figures.total).toMatchObject({ tokens: 50, costUsd: 0.5 })
  })

  test('a finished agent keeps its stored snapshot even with a stale live row', () => {
    const figures = summarizeSession({ events: [...events, report('a1')], snapshots: stored, liveAgents: [liveAgent('a1')] }, CTX)

    expect(figures.agents[0]).toMatchObject({ tokens: 10, costUsd: 0.25 })
  })

  test('a running agent without a live row falls back to its stored snapshot', () => {
    const figures = summarizeSession({ events, snapshots: stored, liveAgents: [] }, CTX)

    expect(figures.agents[0]).toMatchObject({ tokens: 10, costUsd: 0.25 })
  })
})
