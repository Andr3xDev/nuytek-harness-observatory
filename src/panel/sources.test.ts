import { describe, expect, test } from 'claude-code/testing'
import type { EventRecord, SessionFigures } from '../core/figures'
import { summarizeSession } from '../report/analysis'
import { CTX, NOW, sessionStart, spawn, verdict } from '../report/analysis/test-fixtures'
import { createLiveLoaders, createSources, liveAgentsOf, type LiveLoaderDeps } from './sources'

const figures = { agents: [] } as unknown as SessionFigures

// The no `$.fs` / no store writer rule cannot be a test: a plugin test module may
// import only relative files and "claude-code" (no node:fs). Checked by grep in the task proof.
describe('sources failure wrapper', () => {
  test('ready results pass the loader payload through', async () => {
    const sources = createSources({
      loadSession: async () => ({ sessionFigures: figures, aggregate: { a: 1 }, liveAgentIds: ['x'] }),
      loadHistory: async () => ({ aggregate: { h: 1 } }),
      liveSession: () => null,
    })
    expect(await sources.loadSessionAggregate('s1')).toEqual({
      status: 'ready',
      sessionFigures: figures,
      aggregate: { a: 1 },
      liveAgentIds: ['x'],
    })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'ready', aggregate: { h: 1 } })
  })

  test('a throwing or rejecting loader yields unavailable and does not throw', async () => {
    const sources = createSources({
      loadSession: () => {
        throw new Error('sync boom')
      },
      loadHistory: () => Promise.reject(new Error('async boom')),
      liveSession: () => null,
    })
    expect(await sources.loadSessionAggregate('s1')).toEqual({ status: 'unavailable', reason: 'sync boom' })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'unavailable', reason: 'async boom' })
  })

  test('a non-Error rejection keeps a string reason', async () => {
    const sources = createSources({ loadSession: () => Promise.reject('plain'), loadHistory: () => Promise.reject(42), liveSession: () => null })
    expect(await sources.loadSessionAggregate('s1')).toEqual({ status: 'unavailable', reason: 'plain' })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'unavailable', reason: '42' })
  })
})

describe('live loaders', () => {
  const stored = summarizeSession({ events: [], snapshots: [] }, { now: 1, sourceMtimeMs: 1 })
  const pending = [{ id: 'p1', sessionId: 's1' }] as unknown as ReturnType<LiveLoaderDeps['pendingEvents']>

  const build = (overrides: Partial<LiveLoaderDeps> = {}) => {
    const calls: Parameters<LiveLoaderDeps['loadSessions']>[0][] = []
    const deps: LiveLoaderDeps = {
      now: () => 1,
      loadSessions: async options => (calls.push(options), [stored]),
      pendingEvents: () => pending,
      listAgents: async () => [{ id: 'a1', usage: [], cost: { usd: 0.5 } }],
      readContext: async () => ({ percent: 40, window: 200_000 }),
      readMainAgent: async () => 'tech-orchestrator',
      ...overrides,
    }
    return { loaders: createLiveLoaders(deps), calls }
  }

  test('the session load passes pending events and running agents to the store loader', async () => {
    const { loaders, calls } = build()
    const load = await loaders.loadSession('s1')
    expect(calls[0]?.sessionIds).toEqual(['s1'])
    expect(calls[0]?.pendingEvents?.s1).toBe(pending)
    expect(calls[0]?.liveAgents?.s1).toEqual([{ agentId: 'a1', usage: [], costUsd: 0.5 }])
    expect(load.liveAgentIds).toEqual(['a1'])
    expect(load.context).toEqual({ percent: 40, window: 200_000 })
    expect(load.mainAgent).toBe('tech-orchestrator')
  })

  test('a failed agent list keeps the stored figures and no live ids', async () => {
    const { loaders, calls } = build({ listAgents: () => Promise.reject(new Error('down')) })
    const load = await loaders.loadSession('s1')
    expect(load.sessionFigures).toBe(stored)
    expect(load.liveAgentIds).toEqual([])
    expect(calls[0]?.liveAgents?.s1).toEqual([])
  })

  test('a session without data and a failed context read', async () => {
    const empty = build({ loadSessions: async () => [] })
    await expect(empty.loaders.loadSession('s1')).rejects.toThrow('no data')
    const noContext = build({ readContext: () => Promise.reject(new Error('x')), readMainAgent: () => Promise.reject(new Error('x')) })
    const load = await noContext.loaders.loadSession('s1')
    expect(load.context).toBeNull()
    expect(load.mainAgent).toBeNull()
  })

  test('the history load reads every session', async () => {
    const { loaders, calls } = build()
    await loaders.loadHistory()
    expect(calls[0]).toEqual({})
  })

  test('host snake_case usage and a missing cost map to a live agent', () => {
    const usage = [{ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4, model: 'm' }]
    expect(liveAgentsOf([{ id: 'a', usage }])[0]).toMatchObject({ agentId: 'a', costUsd: null })
    expect(liveAgentsOf([{ id: 'a', usage }])[0]?.usage).toHaveLength(1)
  })
})

describe('live session overlay', () => {
  const start = sessionStart()
  const first = spawn('a1')
  const second = spawn('a2')
  const denied = verdict('t1', 'deny')

  // Seeds the overlay the way the real store loader does: through `onSessionInput`.
  const seeded = (storedEvents: EventRecord[], pendingNow: () => EventRecord[]) => {
    return createLiveLoaders({
      now: () => NOW,
      loadSessions: async options => {
        options.onSessionInput?.('s1', { events: storedEvents, snapshots: [], pendingEvents: options.pendingEvents?.s1 })
        return [summarizeSession({ events: storedEvents, snapshots: [] }, CTX)]
      },
      pendingEvents: pendingNow,
      listAgents: async () => [],
      readContext: async () => null,
      readMainAgent: async () => null,
    })
  }

  test('is empty until a store read seeds it, and for another session id', async () => {
    const loaders = seeded([start], () => [])
    expect(loaders.liveSession('s1')).toBeNull()
    await loaders.loadSession('s1')
    expect(loaders.liveSession('s1')).not.toBeNull()
    expect(loaders.liveSession('s2')).toBeNull()
  })

  test('counts new pending events without a store read and dedupes ids seen in both', async () => {
    let pending: EventRecord[] = []
    const loaders = seeded([start, first], () => pending)
    await loaders.loadSession('s1')
    expect(loaders.liveSession('s1')?.sessionFigures.agents).toHaveLength(1)

    pending = [first, second, denied]
    const live = loaders.liveSession('s1')?.sessionFigures
    expect(live?.agents.map(agent => agent.agentId)).toEqual(['a1', 'a2'])
    expect(live?.denies).toBe(1)
  })

  test('keeps events that left the pending list after a flush', async () => {
    let pending: EventRecord[] = [second]
    const loaders = seeded([start, first], () => pending)
    await loaders.loadSession('s1')
    expect(loaders.liveSession('s1')?.sessionFigures.agents).toHaveLength(2)

    pending = []
    expect(loaders.liveSession('s1')?.sessionFigures.agents).toHaveLength(2)
  })

  test('a new store read resets the accumulated events', async () => {
    let pending: EventRecord[] = []
    const loaders = seeded([start], () => pending)
    await loaders.loadSession('s1')
    pending = [first]
    expect(loaders.liveSession('s1')?.sessionFigures.agents).toHaveLength(1)

    pending = []
    await loaders.loadSession('s1')
    expect(loaders.liveSession('s1')?.sessionFigures.agents).toHaveLength(0)
  })
})
