import { describe, expect, test } from 'claude-code/testing'
import { RECENT_AGENTS_CAP } from '../../core/constants'
import { combineSessions } from './combine'
import { summarizeSession } from './session'
import { commandRun, sessionEnd, sessionStart, snapshot, spawn, report, skillUse, usage } from './test-fixtures'
import type { AgentSnapshot } from '../../core/schema'
import type { EventRecord } from './types'

const agentSnapshot = (agentId: string, sessionId: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => {
  const tokens = overrides.usage?.[0]?.input ?? 0
  return snapshot(agentId, { sessionId, ...overrides, tokenCount: tokens })
}

const tokensSnapshot = (agentId: string, sessionId: string, tokens: number, subagentType = 'builder', overrides: Partial<AgentSnapshot> = {}) =>
  agentSnapshot(agentId, sessionId, { subagentType, usage: [usage(tokens, 0, 0, 0)], ...overrides })

const summarize = (events: EventRecord[], snapshots: AgentSnapshot[] = []) => summarizeSession({ events, snapshots })

describe('combineSessions by type', () => {
  test('sums spawns and tokens per agent type across sessions', () => {
    const a = summarize(
      [spawn('a1', { sessionId: 'sa' }), spawn('a2', { sessionId: 'sa' }), spawn('e1', { sessionId: 'sa', subagentType: 'explorer' })],
      [tokensSnapshot('a1', 'sa', 100), tokensSnapshot('a2', 'sa', 200), tokensSnapshot('e1', 'sa', 300, 'explorer')],
    )
    const b = summarize(
      [spawn('a3', { sessionId: 'sb' }), spawn('e2', { sessionId: 'sb', subagentType: 'explorer' })],
      [tokensSnapshot('a3', 'sb', 200), tokensSnapshot('e2', 'sb', 200, 'explorer')],
    )

    const aggregate = combineSessions([a, b])

    expect(aggregate.total.tokens).toBe(1000)
    expect(aggregate.byType.find((row) => row.type === 'builder')).toMatchObject({ spawns: 3, tokens: 500 })
    expect(aggregate.byType.find((row) => row.type === 'explorer')).toMatchObject({ spawns: 2, tokens: 500 })
  })

  test('an empty list returns a zeroed aggregate', () => {
    const empty = combineSessions([])

    expect(empty).toMatchObject({ sessions: 0, windowStart: null, windowEnd: null, profile: null, byType: [], byModel: [] })
    expect(empty.total.tokens).toBe(0)
  })
})

describe('combineSessions by type and model', () => {
  test('groups agents by type and model across sessions; a missing model stays null', () => {
    const a = summarize(
      [spawn('a1', { sessionId: 'sa' }), spawn('a2', { sessionId: 'sa' }), spawn('a3', { sessionId: 'sa' })],
      [
        agentSnapshot('a1', 'sa', { model: '', usage: [usage(100, 0, 0, 0, 'haiku')] }),
        agentSnapshot('a2', 'sa', { model: '', usage: [usage(300, 0, 0, 0, 'opus')] }),
        agentSnapshot('a3', 'sa', { model: '', usage: [usage(50, 0, 0, 0, '')] }),
      ],
    )
    const b = summarize([spawn('a4', { sessionId: 'sb' })], [agentSnapshot('a4', 'sb', { model: '', usage: [usage(200, 0, 0, 0, 'haiku')] })])

    expect(combineSessions([a, b]).byTypeModelEffort.map(({ type, model, spawns, tokens }) => ({ type, model, spawns, tokens }))).toEqual([
      { type: 'builder', model: 'haiku', spawns: 2, tokens: 300 },
      { type: 'builder', model: 'opus', spawns: 1, tokens: 300 },
      { type: 'builder', model: null, spawns: 1, tokens: 50 },
    ])
  })

  test('splits the same type and model by effort, a missing effort staying null', () => {
    const figures = summarize(
      [spawn('a1'), spawn('a2'), spawn('a3')],
      [
        tokensSnapshot('a1', 's1', 100, 'builder', { effort: 'high' }),
        tokensSnapshot('a2', 's1', 200, 'builder', { effort: 'high' }),
        tokensSnapshot('a3', 's1', 50),
      ],
    )

    expect(combineSessions([figures]).byTypeModelEffort.map(({ effort, spawns, tokens }) => ({ effort, spawns, tokens }))).toEqual([
      { effort: 'high', spawns: 2, tokens: 300 },
      { effort: null, spawns: 1, tokens: 50 },
    ])
  })
})

describe('combineSessions recent agents', () => {
  test('lists the newest runs first across sessions and caps the list', () => {
    const many = Array.from({ length: RECENT_AGENTS_CAP + 5 }, (_, index) => spawn(`a${index}`, { sessionId: 'sa', ts: 1000 + index }))
    const a = summarize(many)
    const b = summarize([spawn('late', { sessionId: 'sb', ts: 9000 })])

    const recent = combineSessions([a, b]).recentAgents

    expect(recent).toHaveLength(RECENT_AGENTS_CAP)
    expect(recent[0]?.startedAt).toBe(9000)
    expect(recent[1]?.startedAt).toBe(1000 + RECENT_AGENTS_CAP + 4)
  })
})

describe('combineSessions merging', () => {
  test('sums additive figures like summarizing the union of the sessions', () => {
    const eventsA = [spawn('a1', { sessionId: 'sa' }), report('a1', { sessionId: 'sa', engineStatus: 'completed' })]
    const eventsB = [spawn('a2', { sessionId: 'sb' }), report('a2', { sessionId: 'sb', engineStatus: 'failed' })]
    const snapshotA = tokensSnapshot('a1', 'sa', 100, 'builder', { costUsd: 0.5 })
    const snapshotB = tokensSnapshot('a2', 'sb', 300, 'builder', { costUsd: 0.25 })

    const aggregate = combineSessions([summarize(eventsA, [snapshotA]), summarize(eventsB, [snapshotB])])
    const union = summarize([...eventsA, ...eventsB], [snapshotA, snapshotB])

    expect(aggregate.total).toEqual(union.total)
    expect(aggregate.byType[0]).toMatchObject({ spawns: 2, tokens: 400 })
    expect(aggregate.sessions).toBe(2)
  })

  test('merges tools across sessions', () => {
    const a = summarize([skillUse('foo', 'read'), skillUse('foo', 'prompted'), commandRun('/obs')])
    const b = summarize([skillUse('foo', 'read'), skillUse('foo', 'invoked')])

    const tools = combineSessions([a, b]).tools

    expect(tools.skills.foo).toMatchObject({ prompted: 1, read: 2, invoked: 1 })
    expect(tools.commands['/obs']).toBe(1)
  })

  test('window spans the earliest start to the latest event, closed or open', () => {
    const closed = summarize([sessionStart({ ts: 100 }), sessionEnd({ ts: 500 })])
    const open = summarize([sessionStart({ sessionId: 's2', ts: 400 }), spawn('a1', { sessionId: 's2', ts: 900 })])

    expect(combineSessions([closed, open])).toMatchObject({ windowStart: 100, windowEnd: 900, sessions: 2 })
  })

  test('an unknown price in one session flags the total', () => {
    const priced = summarize([spawn('a1')], [tokensSnapshot('a1', 's1', 100)])
    const unpriced = summarize([spawn('a2', { sessionId: 's2' })], [tokensSnapshot('a2', 's2', 100, 'builder', { hasUnknownPrice: true })])

    expect(combineSessions([priced, unpriced]).total.hasUnknownPrice).toBe(true)
    expect(combineSessions([priced]).total.hasUnknownPrice).toBe(false)
  })
})

describe('combineSessions profile figures', () => {
  const profileOn = (sessionId: string, ...rest: EventRecord[]) => summarize([sessionStart({ sessionId, harnessProfile: true }), ...rest])
  const profileOff = (sessionId: string, ...rest: EventRecord[]) => summarize([sessionStart({ sessionId, harnessProfile: false }), ...rest])

  test('sums injected skills over profile-on sessions only', () => {
    const on = profileOn('s1', spawn('r1', { sessionId: 's1', skillsInjected: ['alpha'] }))
    const alsoOn = profileOn('s3', spawn('r3', { sessionId: 's3', skillsInjected: ['alpha', 'beta'] }))
    const off = profileOff('s2', spawn('r2', { sessionId: 's2', skillsInjected: ['alpha'] }))

    expect(combineSessions([on, alsoOn, off]).profile).toEqual({ skillsInjected: { alpha: 2, beta: 1 } })
  })

  test('profile is null when no session has the profile on', () => {
    expect(combineSessions([profileOff('s1'), profileOff('s2')]).profile).toBeNull()
  })
})
