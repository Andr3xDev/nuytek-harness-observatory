import { describe, expect, test } from 'claude-code/testing'
import { combineSessions } from './combine'
import { summarizeSession } from './session'
import { CTX, commandRun, sessionEnd, sessionStart, snapshot, spawn, report, skillUse, turn, usage, verdict } from './test-fixtures'
import type { AgentSnapshot } from '../../core/schema'
import type { EventRecord } from './types'

const agentSnapshot = (agentId: string, sessionId: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => {
  const tokens = overrides.usage?.[0]?.input ?? 0
  return snapshot(agentId, { sessionId, ...overrides, tokenCount: tokens })
}

const tokensSnapshot = (agentId: string, sessionId: string, tokens: number, subagentType = 'builder', overrides: Partial<AgentSnapshot> = {}) =>
  agentSnapshot(agentId, sessionId, { subagentType, usage: [usage(tokens, 0, 0, 0)], ...overrides })

const summarize = (events: EventRecord[], snapshots: AgentSnapshot[] = []) => summarizeSession({ events, snapshots }, CTX)

describe('combineSessions shares', () => {
  test('computes spawn and token share per agent type across sessions', () => {
    const a = summarize(
      [spawn('a1', { sessionId: 'sa' }), spawn('a2', { sessionId: 'sa' }), spawn('e1', { sessionId: 'sa', subagentType: 'explorer' }), spawn('e2', { sessionId: 'sa', subagentType: 'explorer' }), spawn('e3', { sessionId: 'sa', subagentType: 'explorer' })],
      [tokensSnapshot('a1', 'sa', 100), tokensSnapshot('a2', 'sa', 200), tokensSnapshot('e1', 'sa', 200, 'explorer'), tokensSnapshot('e2', 'sa', 200, 'explorer'), tokensSnapshot('e3', 'sa', 300, 'explorer')],
    )
    const b = summarize(
      [spawn('a3', { sessionId: 'sb' }), spawn('e4', { sessionId: 'sb', subagentType: 'explorer' }), spawn('e5', { sessionId: 'sb', subagentType: 'explorer' }), spawn('e6', { sessionId: 'sb', subagentType: 'explorer' }), spawn('e7', { sessionId: 'sb', subagentType: 'explorer' })],
      [tokensSnapshot('a3', 'sb', 200), tokensSnapshot('e4', 'sb', 200, 'explorer'), tokensSnapshot('e5', 'sb', 200, 'explorer'), tokensSnapshot('e6', 'sb', 200, 'explorer'), tokensSnapshot('e7', 'sb', 200, 'explorer')],
    )

    const aggregate = combineSessions([a, b])
    const builder = aggregate.byType.find((row) => row.type === 'builder')

    expect(aggregate.total.tokens).toBe(2000)
    expect(builder).toMatchObject({ spawns: 3, tokens: 500, spawnShare: 0.3, tokenShare: 0.25 })
  })

  test('shares are null at a zero token total and an empty list returns a zeroed aggregate', () => {
    const noTokens = combineSessions([summarize([spawn('a1')])])
    const empty = combineSessions([])

    expect(noTokens.byType[0]).toMatchObject({ type: 'builder', spawnShare: 1, tokenShare: null, avgTokens: 0 })
    expect(empty).toMatchObject({ sessions: 0, openSessions: 0, windowStart: null, windowEnd: null, cacheRatio: null, profile: null, byType: [], byModel: [], byIssue: [], denies: 0 })
    expect(empty.total.tokens).toBe(0)
  })
})

describe('combineSessions by type and model', () => {
  test('groups agents by type and model across sessions; a missing model stays null', () => {
    const a = summarize(
      [spawn('a1', { sessionId: 'sa' }), spawn('a2', { sessionId: 'sa' }), spawn('a3', { sessionId: 'sa' })],
      [
        agentSnapshot('a1', 'sa', { usage: [usage(100, 0, 0, 0, 'haiku')] }),
        agentSnapshot('a2', 'sa', { usage: [usage(300, 0, 0, 0, 'opus')] }),
        agentSnapshot('a3', 'sa', { model: '', usage: [usage(50, 0, 0, 0, '')] }),
      ],
    )
    const b = summarize([spawn('a4', { sessionId: 'sb' })], [agentSnapshot('a4', 'sb', { usage: [usage(200, 0, 0, 0, 'haiku')] })])

    expect(combineSessions([a, b]).byTypeModel.map(({ type, model, spawns, tokens }) => ({ type, model, spawns, tokens }))).toEqual([
      { type: 'builder', model: 'haiku', spawns: 2, tokens: 300 },
      { type: 'builder', model: 'opus', spawns: 1, tokens: 300 },
      { type: 'builder', model: null, spawns: 1, tokens: 50 },
    ])
  })
})

describe('combineSessions derived per-type figures', () => {
  test('per-type cache ratio, average tokens and average duration', () => {
    const figures = summarize(
      [spawn('a1'), spawn('a2'), turn('a1', { durationMs: 20000 }), turn('a2', { durationMs: 40000 })],
      [agentSnapshot('a1', 's1', { usage: [usage(5000, 0, 15000, 5000)] }), agentSnapshot('a2', 's1', { usage: [usage(5000, 0, 15000, 5000)] })],
    )

    const aggregate = combineSessions([figures])

    expect(aggregate.byType[0]).toMatchObject({ cacheRatio: 0.6, avgTokens: 25000, avgDurationMs: 30000 })
    expect(aggregate.cacheRatio).toBe(0.6)
  })
})

describe('combineSessions merging', () => {
  test('sums additive figures like summarizing the union of the sessions', () => {
    const eventsA = [spawn('a1', { sessionId: 'sa' }), verdict('ta', 'deny', { sessionId: 'sa' }), report('a1', { sessionId: 'sa', engineStatus: 'completed' })]
    const eventsB = [spawn('a2', { sessionId: 'sb' }), verdict('tb', 'deny', { sessionId: 'sb' }), report('a2', { sessionId: 'sb', engineStatus: 'failed' })]
    const snapshotA = tokensSnapshot('a1', 'sa', 100, 'builder', { costUsd: 0.5 })
    const snapshotB = tokensSnapshot('a2', 'sb', 300, 'builder', { costUsd: 0.25 })

    const aggregate = combineSessions([summarize(eventsA, [snapshotA]), summarize(eventsB, [snapshotB])])
    const union = summarize([...eventsA, ...eventsB], [snapshotA, snapshotB])

    expect(aggregate.total).toEqual(union.total)
    expect(aggregate.denies).toBe(union.denies)
    expect(aggregate.byType[0]).toMatchObject({ spawns: 2, tokens: 400 })
    expect(aggregate.engineStatusMix).toEqual({ completed: 1, failed: 1 })
    expect(aggregate.sessions).toBe(2)
  })

  test('merges tools across sessions', () => {
    const a = summarize([skillUse('foo', 'read'), skillUse('foo', 'prompted'), commandRun('/obs')])
    const b = summarize([skillUse('foo', 'read'), skillUse('foo', 'invoked')])

    const tools = combineSessions([a, b]).tools

    expect(tools.skills.foo).toMatchObject({ prompted: 1, read: 2, invoked: 1 })
    expect(tools.commands['/obs']).toBe(1)
  })

  test('byIssue merges the same issue across sessions and sorts by cost descending', () => {
    const a = summarize(
      [spawn('a1', { sessionId: 'sa' }), spawn('a2', { sessionId: 'sa' })],
      [tokensSnapshot('a1', 'sa', 1, 'builder', { costUsd: 0.375, branch: 'feature/io-2-y' }), tokensSnapshot('a2', 'sa', 1, 'builder', { costUsd: 0.25, branch: 'feature/io-1-x' })],
    )
    const b = summarize([spawn('a3', { sessionId: 'sb' })], [tokensSnapshot('a3', 'sb', 1, 'builder', { costUsd: 0.25, branch: 'feature/io-1-x' })])

    const byIssue = combineSessions([a, b]).byIssue

    expect(byIssue.map((row) => [row.issue, row.costUsd])).toEqual([
      ['IO-1', 0.5],
      ['IO-2', 0.375],
    ])
  })

  test('window spans the earliest start to the latest end and counts open sessions', () => {
    const closed1 = summarize([sessionStart({ ts: 100 }), sessionEnd({ ts: 500 })])
    const closed2 = summarize([sessionStart({ sessionId: 's2', ts: 300 }), sessionEnd({ sessionId: 's2', ts: 900 })])
    const open = summarize([sessionStart({ sessionId: 's3', ts: 400 })])

    const aggregate = combineSessions([closed1, closed2, open])

    expect(aggregate).toMatchObject({ windowStart: 100, windowEnd: 900, openSessions: 1, sessions: 3 })
  })
})

describe('combineSessions window end', () => {
  test('uses the latest event of open sessions when nothing is closed', () => {
    const open = summarize([sessionStart({ ts: 100 }), spawn('a1', { ts: 700 })])

    expect(combineSessions([open])).toMatchObject({ windowStart: 100, windowEnd: 700 })
  })
})

describe('combineSessions profile figures', () => {
  const profileOn = (sessionId: string, ...rest: EventRecord[]) => summarize([sessionStart({ sessionId, harnessProfile: true }), ...rest])
  const profileOff = (sessionId: string, ...rest: EventRecord[]) => summarize([sessionStart({ sessionId, harnessProfile: false }), ...rest])

  test('sums over profile-on sessions only and reports coverage', () => {
    const on = profileOn('s1', spawn('r1', { sessionId: 's1', subagentType: 'code-reviewer' }))
    const off = profileOff('s2', spawn('r2', { sessionId: 's2', subagentType: 'code-reviewer' }))

    const profile = combineSessions([on, off]).profile

    expect(profile?.coverage).toEqual({ profileSessions: 1, sessions: 2 })
    expect(profile?.reviewPasses).toBe(1)
  })

  test('profile is null when no session has the profile on', () => {
    expect(combineSessions([profileOff('s1'), profileOff('s2')]).profile).toBeNull()
  })

  test('bashPromptHook sums calls and usd over profile-on sessions, null when none', () => {
    const withEstimate = profileOn(
      's1',
      verdict('b1', 'allow', { sessionId: 's1' }),
      verdict('b2', 'allow', { sessionId: 's1' }),
      sessionEnd({ sessionId: 's1', estimates: { bashPromptHook: { label: 'estimated', calls: 2, usd: 0.25 } } }),
    )
    const withoutEstimate = profileOn('s2', verdict('b3', 'allow', { sessionId: 's2' }))

    expect(combineSessions([withEstimate, withoutEstimate]).tools.bashPromptHook).toEqual({ calls: 3, usd: 0.25 })
    expect(combineSessions([withoutEstimate]).tools.bashPromptHook).toEqual({ calls: 1, usd: null })
    expect(combineSessions([profileOff('s3')]).tools.bashPromptHook).toBeNull()
  })
})
