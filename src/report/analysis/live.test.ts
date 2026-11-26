import { describe, expect, test } from 'claude-code/testing'
import { mergeLiveEvents } from './live'
import { summarizeSession } from './session'
import type { LiveAgent } from '../../core/figures'
import { report, sessionStart, snapshot, spawn, turn, usage } from './test-fixtures'

const SNAPSHOT_USAGE = usage(10, 0, 0, 0)
const LIVE_USAGE = usage(50, 0, 0, 0)

const liveAgent = (agentId: string, overrides: Partial<LiveAgent> = {}): LiveAgent => ({
  agentId,
  usage: [LIVE_USAGE],
  costUsd: 0.5,
  hasUnknownPrice: false,
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

describe('summarizeSession live agent overlay', () => {
  const events = [spawn('a1')]
  const stored = [snapshot('a1', { usage: [SNAPSHOT_USAGE], costUsd: 0.25 })]

  test('a running agent shows the host usage and cost', () => {
    const figures = summarizeSession({ events, snapshots: stored, liveAgents: [liveAgent('a1')] })

    expect(figures.agents[0]).toMatchObject({ agentId: 'a1', tokens: 50, costUsd: 0.5 })
    expect(figures.total).toMatchObject({ tokens: 50, costUsd: 0.5 })
  })

  test('a live agent flagged with an unknown price keeps its known cost and the flag', () => {
    const figures = summarizeSession({ events, snapshots: stored, liveAgents: [liveAgent('a1', { hasUnknownPrice: true })] })

    expect(figures.agents[0]).toMatchObject({ costUsd: 0.5, hasUnknownPrice: true })
    expect(figures.total.hasUnknownPrice).toBe(true)
  })

  test('a finished agent keeps its stored snapshot even with a stale live row', () => {
    const figures = summarizeSession({ events: [...events, report('a1')], snapshots: stored, liveAgents: [liveAgent('a1')] })

    expect(figures.agents[0]).toMatchObject({ tokens: 10, costUsd: 0.25 })
  })

  test('a running agent without a live row falls back to its stored snapshot', () => {
    const figures = summarizeSession({ events, snapshots: stored, liveAgents: [] })

    expect(figures.agents[0]).toMatchObject({ tokens: 10, costUsd: 0.25 })
  })
})
