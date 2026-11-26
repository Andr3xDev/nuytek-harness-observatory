import { describe, expect, test } from 'claude-code/testing'
import { SCHEMA_VERSION, type AgentSnapshot, type UsageRecord } from '../../core/schema'
import {
  createSnapshotTracker,
  sweepStaleSnapshots,
  type SnapshotAgent,
  type SnapshotCycleInput,
  type SnapshotWrite,
} from './snapshots'

const SNAPSHOT_KEYS = [
  'schema',
  'sessionId',
  'agentId',
  'parentAgentId',
  'subagentType',
  'model',
  'branch',
  'startedAt',
  'updatedAt',
  'usage',
  'costUsd',
  'tokenCount',
  'hasUnknownPrice',
  'taskStatus',
  'closed',
  'closedReason',
].sort()

const HOST_USAGE = {
  input_tokens: 10,
  output_tokens: 20,
  cache_read_input_tokens: 30,
  cache_creation_input_tokens: 40,
  model: 'claude-x',
}
const MAIN_TURN: UsageRecord = { input: 1, output: 2, cacheRead: 3, cacheCreation: 4, model: 'claude-main' }

const agent = (id: string, overrides: Partial<SnapshotAgent> = {}): SnapshotAgent => ({
  id,
  type: 'builder',
  parentId: undefined,
  taskStatus: 'running',
  tokenCount: 100,
  usage: [HOST_USAGE],
  cost: { usd: 0.2 },
  ...overrides,
})

const input = (overrides: Partial<SnapshotCycleInput> = {}): SnapshotCycleInput => ({
  branch: 'main',
  now: 5_000,
  startedAt: 1_000,
  sessionUsd: 1.0,
  hasUnknownPrice: false,
  agents: [agent('a1')],
  ...overrides,
})

const byFile = (writes: SnapshotWrite[], file: string): AgentSnapshot | undefined =>
  writes.find((w) => w.file === file)?.snapshot

describe('main snapshot cost floor', () => {
  const mainOf = (overrides: Partial<SnapshotCycleInput>): AgentSnapshot | undefined =>
    byFile(createSnapshotTracker('s1').cycle(input(overrides)), 'main-s1.json')

  test('unknown session cost keeps main cost at 0 and flags it unknown', () => {
    const snap = mainOf({ sessionUsd: 0, sessionCostKnown: false, agents: [agent('a1', { cost: { usd: 0.3 } })] })
    expect(snap?.costUsd).toBe(0)
    expect(snap?.hasUnknownPrice).toBe(true)
  })

  test('known session cost below the agents sum floors main cost at 0', () => {
    const snap = mainOf({ sessionUsd: 0.1, sessionCostKnown: true, agents: [agent('a1', { cost: { usd: 0.3 } })] })
    expect(snap?.costUsd).toBe(0)
    expect(snap?.hasUnknownPrice).toBe(false)
  })
})

describe('snapshot content', () => {
  test('the agent effort is stored as given and the key is left out when none was set', () => {
    const writes = createSnapshotTracker('s1').cycle(
      input({ agents: [agent('a1', { effort: 'high' }), agent('a2', { effort: 4000 }), agent('a3')] }),
    )
    expect(byFile(writes, 'a1.json')?.effort).toBe('high')
    expect(byFile(writes, 'a2.json')?.effort).toBe(4000)
    expect(byFile(writes, 'a3.json')).not.toHaveProperty('effort')
  })

  test('an agent inheriting the session effort takes effort and model from its last request', () => {
    const writes = createSnapshotTracker('s1').cycle(
      input({ agents: [agent('a1', { usage: [], lastRequest: { model: 'claude-opus', effort: 'xhigh' } })] }),
    )
    expect(byFile(writes, 'a1.json')).toMatchObject({ effort: 'xhigh', model: 'claude-opus' })
  })

  test('the model comes from the agent, then its last request, then its usage, else is empty', () => {
    const modelOf = (overrides: Partial<SnapshotAgent>) =>
      byFile(createSnapshotTracker('s1').cycle(input({ agents: [agent('a1', overrides)] })), 'a1.json')?.model
    expect(modelOf({ model: 'claude-agent', lastRequest: { model: 'claude-last' } })).toBe('claude-agent')
    expect(modelOf({ lastRequest: { model: 'claude-last' } })).toBe('claude-last')
    expect(modelOf({})).toBe('claude-x')
    expect(modelOf({ usage: [] })).toBe('')
  })

  test('an explicit effort beats the last request effort', () => {
    const writes = createSnapshotTracker('s1').cycle(input({ agents: [agent('a1', { effort: 'low', lastRequest: { model: 'claude-last', effort: 'max' } })] }))
    expect(byFile(writes, 'a1.json')?.effort).toBe('low')
  })

  test('a subagent snapshot has every field, camelCase usage and closed false', () => {
    const writes = createSnapshotTracker('s1').cycle(input({ agents: [agent('a1', { parentId: 'p1' })] }))
    const snap = byFile(writes, 'a1.json')
    expect(Object.keys(snap ?? {}).sort()).toEqual(SNAPSHOT_KEYS)
    expect(snap).toMatchObject({
      schema: SCHEMA_VERSION,
      sessionId: 's1',
      agentId: 'a1',
      parentAgentId: 'p1',
      subagentType: 'builder',
      branch: 'main',
      startedAt: 1_000,
      updatedAt: 5_000,
      costUsd: 0.2,
      tokenCount: 100,
      hasUnknownPrice: false,
      taskStatus: 'running',
      closed: false,
      closedReason: null,
      usage: [{ input: 10, output: 20, cacheRead: 30, cacheCreation: 40, model: 'claude-x' }],
    })
  })

  test('the main snapshot comes from the ledger and the cumulative residual cost', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.recordMainTurn(MAIN_TURN)
    const snap = byFile(tracker.cycle(input({ sessionUsd: 1.0, agents: [agent('a1', { cost: { usd: 0.3 } })] })), 'main-s1.json')
    expect(snap).toMatchObject({
      agentId: 'main',
      parentAgentId: null,
      sessionId: 's1',
      usage: [MAIN_TURN],
      model: 'claude-main',
      closed: false,
    })
    expect(Math.abs((snap?.costUsd ?? 0) - 0.7)).toBeLessThan(1e-9)
  })

  test('two sessions write distinct main snapshot files', () => {
    const files = ['sess-a', 'sess-b'].flatMap((id) => createSnapshotTracker(id).cycle(input({ agents: [] })).map((w) => w.file))
    expect(files).toEqual(['main-sess-a.json', 'main-sess-b.json'])
  })
})

describe('change signature', () => {
  test('an unchanged agent is not written again, a grown one is', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.cycle(input())
    const same = tracker.cycle(input({ now: 6_000 }))
    expect(byFile(same, 'a1.json')).toBeUndefined()
    const grown = tracker.cycle(input({ now: 7_000, agents: [agent('a1', { tokenCount: 150 })] }))
    expect(byFile(grown, 'a1.json')?.tokenCount).toBe(150)
  })

  test('a change of only the model or only the effort is written', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.cycle(input({ agents: [agent('a1', { model: 'claude-a', effort: 'low' })] }))
    const modelChanged = tracker.cycle(input({ now: 6_000, agents: [agent('a1', { model: 'claude-b', effort: 'low' })] }))
    expect(byFile(modelChanged, 'a1.json')?.model).toBe('claude-b')
    const effortChanged = tracker.cycle(input({ now: 7_000, agents: [agent('a1', { model: 'claude-b', effort: 'high' })] }))
    expect(byFile(effortChanged, 'a1.json')?.effort).toBe('high')
  })

  test('a change of only the unknown-price flag is written', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.cycle(input())
    const flagged = tracker.cycle(input({ now: 6_000, agents: [agent('a1', { cost: { usd: 0.2, hasUnknownPrice: true } })] }))
    expect(byFile(flagged, 'a1.json')?.hasUnknownPrice).toBe(true)
  })
})

describe('final snapshot at report', () => {
  test('closes the agent with report from the fresh list read', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.cycle(input())
    const writes = tracker.closeAgent('a1', input({ now: 6_000, agents: [agent('a1', { tokenCount: 250, taskStatus: 'completed' })] }))
    expect(byFile(writes, 'a1.json')).toMatchObject({ closed: true, closedReason: 'report', tokenCount: 250, taskStatus: 'completed' })
  })

  test('a closed agent still present in the list is not reopened by later cycles', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.cycle(input())
    tracker.closeAgent('a1', input({ now: 6_000 }))
    const later = tracker.cycle(input({ now: 7_000, agents: [agent('a1', { tokenCount: 999 })] }))
    expect(byFile(later, 'a1.json')).toBeUndefined()
  })
})

describe('usage reset', () => {
  const resetCycle = () => {
    const tracker = createSnapshotTracker('s1')
    tracker.recordMainTurn(MAIN_TURN)
    tracker.cycle(input({ agents: [agent('a1'), agent('a2')] }))
    tracker.closeAgent('a2', input({ agents: [agent('a2')] }))
    const writes = tracker.cycle(input({ now: 9_000, startedAt: 2_000, agents: [] }))
    return { tracker, writes }
  }

  test('a startedAt change closes open snapshots with reset from their last content, before new ones', () => {
    const { writes } = resetCycle()
    const closedA1 = writes.findIndex((w) => w.file === 'a1.json')
    const closedMain = writes.findIndex((w) => w.file === 'main-s1.json' && w.snapshot.closed)
    const newMain = writes.findIndex((w) => w.file === 'main-s1.json' && !w.snapshot.closed)
    expect(writes[closedA1]?.snapshot).toMatchObject({ closed: true, closedReason: 'reset', startedAt: 1_000, tokenCount: 100 })
    expect(writes[closedMain]?.snapshot).toMatchObject({ closedReason: 'reset', startedAt: 1_000, usage: [MAIN_TURN] })
    expect(newMain).toBeGreaterThan(closedMain)
    expect(newMain).toBeGreaterThan(closedA1)
  })

  test('new snapshots carry the new startedAt and an empty ledger', () => {
    const { writes } = resetCycle()
    const fresh = writes.find((w) => w.file === 'main-s1.json' && !w.snapshot.closed)?.snapshot
    expect(fresh).toMatchObject({ startedAt: 2_000, usage: [] })
  })

  test('an already reported agent is not rewritten as reset', () => {
    const { writes } = resetCycle()
    expect(byFile(writes, 'a2.json')).toBeUndefined()
  })

  test('closeAllOnReset (session.end clear) closes open snapshots and clears the ledger', () => {
    const tracker = createSnapshotTracker('s1')
    tracker.recordMainTurn(MAIN_TURN)
    tracker.cycle(input())
    const writes = tracker.closeAllOnReset(8_000)
    expect(byFile(writes, 'a1.json')).toMatchObject({ closed: true, closedReason: 'reset' })
    expect(byFile(writes, 'main-s1.json')).toMatchObject({ closed: true, closedReason: 'reset' })
    const next = tracker.cycle(input({ now: 9_000, startedAt: 2_000, agents: [] }))
    expect(byFile(next, 'main-s1.json')?.usage).toEqual([])
  })
})

describe('resume sweep', () => {
  const stored = (sessionId: string, closed: boolean, ageMs: number, now: number) => ({
    name: `${sessionId}-${closed ? 'closed' : 'open'}-${ageMs}.json`,
    mtimeMs: now - ageMs,
    snapshot: {
      ...(byFile(createSnapshotTracker(sessionId).cycle(input({ agents: [agent('x')] })), 'x.json') as AgentSnapshot),
      closed,
    },
  })

  test('closes only open same-session snapshots', () => {
    const now = 100_000
    const files = [stored('s1', false, 1_000, now), stored('s2', false, 1_000, now), stored('s1', true, 1_000, now)]
    const writes = sweepStaleSnapshots('s1', files, now)
    expect(writes.map((w) => w.file)).toEqual([files[0]?.name])
    expect(writes[0]?.snapshot).toMatchObject({ closed: true, closedReason: 'reset', updatedAt: now })
  })
})
