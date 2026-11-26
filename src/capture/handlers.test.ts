import { describe, expect, test } from 'claude-code/testing'
import { createBatcher, type BatchSink } from '../store/write/batcher'
import { createCapture, type HostApi, type Runtime, type SnapshotLister } from './handlers'
import type { ObsEvent } from '../core/schema'
import type { SnapshotAgent } from './session/snapshots'

const SESSION_ID = 's1'
const START = 1_000
const NOW = 1_700_000_000_000

type World = { usd: number; startedAt: number; agents: SnapshotAgent[] }

const setup = (profile = false) => {
  const world: World = { usd: 0, startedAt: START, agents: [] }
  const appended: string[] = []
  const sink: BatchSink = {
    append: async (_path, text) => {
      appended.push(text)
      return true
    },
    upsert: async () => true,
  }
  const batcher = createBatcher(sink, { every: () => () => {} })
  const maintainCalls: string[][] = []
  const order: string[] = []
  const runtime: Runtime = {
    batcher,
    writer: {
      init: async () => {
        order.push('init')
        return true
      },
      maintain: async (...args) => {
        order.push('maintain')
        maintainCalls.push(args)
        return true
      },
    },
    branch: { refresh: async () => 'main', current: () => 'main' },
  }
  const host: HostApi & SnapshotLister = {
    sessionId: async () => SESSION_ID,
    usage: async () => ({ startedAt: world.startedAt, cost: { usd: world.usd } }),
    agents: async () => world.agents,
    listSnapshots: async () => [],
  }
  const capture = createCapture({ profile, retentionDays: '60', runtime: () => runtime, now: () => NOW })
  const events = async (): Promise<ObsEvent[]> => {
    await batcher.flush()
    return appended.flatMap((text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line) as ObsEvent))
  }
  return { world, host, capture, runtime, events, maintainCalls, order }
}

const passThrough = <R>(result: R) => async () => result

const denied = { decision: 'deny' as const, reason: 'Blocked by infra-agent-bash-guard: no', rule: 'r', hook: 'h' }

const bashCheck = { tool: 'Bash', input: { command: 'rm -rf build' }, tool_use_id: 'tu1', agentId: 'a1' }

describe('fail-open observe', () => {
  test('the host decision is returned unchanged when recording throws', async () => {
    const { host, capture, runtime } = setup()
    runtime.batcher.pushEvent = () => {
      throw new Error('writer down')
    }
    const result = await capture.toolCheck(host, bashCheck, passThrough(denied))
    expect(result).toBe(denied)
  })

  test('a query without tool_use_id records nothing', async () => {
    const { host, capture, events } = setup()
    await capture.toolCheck(host, { tool: 'Read', input: {} }, passThrough({ decision: 'allow' as const }))
    expect(await events()).toEqual([])
  })
})

describe('tool.check', () => {
  test('a denied subagent Bash call writes one verdict with agentId and the full command', async () => {
    const { host, capture, events } = setup(true)
    await capture.toolCheck(host, bashCheck, passThrough(denied))
    const verdicts = (await events()).filter((e) => e.type === 'tool.verdict')
    expect(verdicts).toHaveLength(1)
    expect(verdicts[0]).toMatchObject({
      decision: 'deny',
      agentId: 'a1',
      command: 'rm -rf build',
      guard: 'infra-agent-bash-guard',
      rule: 'r',
      hook: 'h',
    })
  })

  test('guard stays null with the profile off but the reason is stored', async () => {
    const { host, capture, events } = setup(false)
    await capture.toolCheck(host, bashCheck, passThrough(denied))
    expect((await events())[0]).toMatchObject({ guard: null, reason: denied.reason })
  })

  test('Read of a SKILL.md and a Skill call write skill.use read and invoked with the agent', async () => {
    const { host, capture, events } = setup()
    const allow = passThrough({ decision: 'allow' as const })
    await capture.toolCheck(host, { tool: 'Read', input: { file_path: '/x/skills/foo/SKILL.md' }, tool_use_id: 't1', agentId: 'a1' }, allow)
    await capture.toolCheck(host, { tool: 'Skill', input: { skill: 'bar' }, tool_use_id: 't2' }, allow)
    const uses = (await events()).filter((e) => e.type === 'skill.use')
    expect(uses).toMatchObject([
      { skill: 'foo', kind: 'read', agentId: 'a1' },
      { skill: 'bar', kind: 'invoked', agentId: null },
    ])
  })
})

describe('skill, command, compact', () => {
  test('skill.prompt writes a prompted skill.use without an agent; command.run carries the name', async () => {
    const { host, capture, events } = setup()
    await capture.skillPrompt(host, { skill: 'commit' }, passThrough({}))
    await capture.commandRun(host, { command: 'status' }, passThrough({}))
    await capture.sessionCompact(host, {}, passThrough({}))
    expect(await events()).toMatchObject([
      { type: 'skill.use', skill: 'commit', kind: 'prompted', agentId: null },
      { type: 'command.run', name: 'status' },
      { type: 'session.compact' },
    ])
  })
})

describe('session lifecycle', () => {
  test('session.start records harnessProfile, runs retention with the configured days and excludes the current files', async () => {
    const { host, capture, events, maintainCalls } = setup(true)
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    expect((await events())[0]).toMatchObject({ type: 'session.start', harnessProfile: true, cwd: '/w', branch: 'main' })
    expect(maintainCalls).toEqual([['60', 's1.jsonl', 'main-s1.json']])
  })

  test('session.start creates the store root before maintenance runs', async () => {
    const { host, capture, order } = setup(true)
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    expect(order).toEqual(['init', 'maintain'])
  })

  test('after a resume the first event of the new host session is adopted with a baseline at the resume point', async () => {
    const { world, host, capture, events } = setup()
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    await capture.sessionEnd(host, { sessionId: SESSION_ID, reason: 'resume' }, passThrough({}))
    host.sessionId = async () => 's2'
    world.usd = 56
    await capture.toolCheck(host, bashCheck, passThrough({ decision: 'allow' as const }))
    world.usd = 57
    await capture.turnComplete(host, { durationMs: 1 }, passThrough({}))
    const resumed = (await events()).filter((e) => e.sessionId === 's2')
    expect(resumed.map((e) => e.type)).toEqual(['tool.verdict', 'turn.complete'])
    expect(resumed[1]).toMatchObject({ costUsd: 1 })
  })

  test('session.end flushes before returning and carries estimates only with the profile on', async () => {
    for (const profile of [true, false]) {
      const { host, capture, events } = setup(profile)
      await capture.toolCheck(host, bashCheck, passThrough({ decision: 'allow' as const }))
      await capture.sessionEnd(host, { sessionId: SESSION_ID, reason: 'other' }, passThrough({}))
      const end = (await events()).find((e) => e.type === 'session.end')
      expect(end !== undefined && 'estimates' in end).toBe(profile)
    }
  })
})

describe('agents and turns', () => {
  test('a spawn writes the event and the prompt record; a denied spawn writes nothing', async () => {
    const { host, capture, events } = setup()
    await capture.agentSpawn(host, { prompt: 'do it', subagentType: 'builder' }, passThrough({ agentId: 'a1' }))
    await capture.agentSpawn(host, { prompt: 'no', subagentType: 'builder' }, passThrough({ deny: 'nope' }))
    const spawns = (await events()).filter((e) => e.type === 'agent.spawn')
    expect(spawns).toMatchObject([{ agentId: 'a1', promptId: 'pr-a1', promptBytes: 5 }])
  })

  test('a main turn is costed as the session delta minus the subagent delta', async () => {
    const { world, host, capture, events } = setup()
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    world.usd = 0.5
    world.agents = [{ id: 'a1', type: 'builder', taskStatus: 'running', tokenCount: 10, cost: { usd: 0.2 } }]
    const usage = { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, model: 'm' }
    await capture.turnComplete(host, { durationMs: 7, usage }, passThrough({}))
    const turn = (await events()).find((e) => e.type === 'turn.complete')
    expect(turn).toMatchObject({ agentId: null, durationMs: 7, usage: { input: 1, cacheCreation: 4, model: 'm' } })
    expect(Math.round((turn as { costUsd: number }).costUsd * 100)).toBe(30)
  })

  test('session usage without cost gives a null costUsd, not a zero reading', async () => {
    const { host, capture, events } = setup()
    host.usage = async () => ({ startedAt: START })
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    await capture.turnComplete(host, { durationMs: 1 }, passThrough({}))
    const turn = (await events()).find((e) => e.type === 'turn.complete')
    expect(turn).toMatchObject({ costUsd: null })
  })

  test('after a /clear the first turn costs the new cumulative and keeps the working directory', async () => {
    const { world, host, capture, events } = setup()
    await capture.sessionStart(host, { cwd: '/w' }, passThrough({ cwd: '/w' }))
    world.usd = 2
    await capture.sessionEnd(host, { sessionId: SESSION_ID, reason: 'clear' }, passThrough({}))
    world.startedAt = START + 1
    world.usd = 0.4
    await capture.turnComplete(host, { durationMs: 1 }, passThrough({}))
    const turn = (await events()).find((e) => e.type === 'turn.complete')
    expect(Math.round((turn as { costUsd: number }).costUsd * 100)).toBe(40)
  })

  test('session.end skips snapshot upserts when the shared budget is nearly spent but still writes events', async () => {
    const { host, capture, runtime } = setup()
    const upserts: string[] = []
    const appended: string[] = []
    runtime.batcher = createBatcher(
      {
        append: async (path) => (appended.push(path), true),
        upsert: async (path) => (upserts.push(path), true),
      },
      { every: () => () => {} },
    )
    runtime.batcher.setSnapshot('a1.json', {} as never)
    const next = Object.assign(passThrough({}), { budget: { remainingMs: 10 } })
    await capture.sessionEnd(host, { sessionId: SESSION_ID, reason: 'other' }, next)
    expect(appended).toEqual([`events/${SESSION_ID}.jsonl`])
    expect(upserts).toEqual([])
  })

  test('a subagent turn carries no costUsd', async () => {
    const { host, capture, events } = setup()
    await capture.turnComplete(host, { durationMs: 1, agentId: 'a1' }, passThrough({}))
    const turn = (await events())[0]
    expect(turn).toMatchObject({ agentId: 'a1' })
    expect(turn !== undefined && 'costUsd' in turn).toBe(false)
  })

  test('turn.complete and agent.report resolve while a disk append is still pending', async () => {
    const { host, capture, runtime } = setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => (release = resolve))
    runtime.batcher = createBatcher({ append: async () => (await gate, true), upsert: async () => true }, { every: () => () => {} })
    await capture.turnComplete(host, { durationMs: 1 }, passThrough({}))
    await capture.agentReport(host, { agentId: 'a1', subagentType: 'builder', status: 'failed' as const, text: 'x' }, passThrough({}))
    expect(runtime.batcher.pendingEvents(SESSION_ID).length).toBeGreaterThan(0)
    release()
    await runtime.batcher.flush()
    expect(runtime.batcher.pendingEvents(SESSION_ID)).toEqual([])
  })

  test('a report writes the event with the engine status and flushes', async () => {
    const { host, capture, events } = setup()
    const report = { agentId: 'a1', subagentType: 'builder', status: 'failed' as const, text: 'oops' }
    await capture.agentReport(host, report, passThrough({ text: 'oops' }))
    expect((await events())[0]).toMatchObject({ type: 'agent.report', engineStatus: 'failed', status: null })
  })
})

describe('session.measure', () => {
  test('costUsd is non-decreasing across two measures and each writes a reconciliation', async () => {
    const { world, host, capture, events } = setup()
    for (const usd of [1, 1.5]) {
      world.usd = usd
      await capture.sessionMeasure(host, { cost: { usd } }, passThrough({}))
    }
    const all = await events()
    const costs = all.filter((e) => e.type === 'session.measure').map((e) => (e as { costUsd: number }).costUsd)
    expect(costs).toEqual([1, 1.5])
    expect(all.filter((e) => e.type === 'reconciliation')).toHaveLength(2)
  })

  test('a measure without cost writes neither the event nor a reconciliation', async () => {
    const { host, capture, events } = setup()
    await capture.sessionMeasure(host, {}, passThrough({}))
    expect(await events()).toEqual([])
  })
})
