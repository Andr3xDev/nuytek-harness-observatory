import { describe, expect, test } from 'claude-code/testing'
import type { ObsEvent } from '../core/schema'
import { createFakeFs, jsonl, type FakeFiles } from '../store/read/test-fs'
import { HOUR_MS, NOW, sessionEnd, sessionStart, snapshot, spawn, usage, verdict } from './analysis/test-fixtures'
import { loadHistory, type EventsCache } from './load-history'

const FRESH_MTIME_MS = NOW - 60_000
const STALE_MTIME_MS = NOW - 7 * HOUR_MS

const closedEvents = (id: string): ObsEvent[] => [sessionStart({ sessionId: id }), spawn(`${id}a`, { sessionId: id }), sessionEnd({ sessionId: id })]
const agentSnapshotFile = (id: string) => JSON.stringify(snapshot(`${id}a`, { sessionId: id, usage: [usage(10, 0, 0, 0)], costUsd: 0.5 }))

const closedSession = (id: string, mtimeMs = STALE_MTIME_MS): FakeFiles => ({
  [`events/${id}.jsonl`]: { content: jsonl(closedEvents(id)), mtimeMs },
  [`snapshots/${id}a.json`]: { content: agentSnapshotFile(id) },
})

const load = (files: FakeFiles, options: Partial<Parameters<typeof loadHistory>[1]> = {}, failingPaths: string[] = []) => {
  const fake = createFakeFs(files, failingPaths)
  return { fake, result: loadHistory({ fs: fake.fs }, options) }
}

describe('loadHistory live sessions', () => {
  test('pending events are merged into the stored session', async () => {
    const { result } = load(closedSession('s1'), { pendingEvents: { s1: [verdict('t9', { sessionId: 's1', mcpServer: 'srv' })] } })

    expect((await result)[0]?.tools.mcp.srv).toBeDefined()
  })

  test('a session with pending events and no events file is included when named in sessionIds', async () => {
    const { result } = load({}, { sessionIds: ['s9'], pendingEvents: { s9: [sessionStart({ sessionId: 's9' }), verdict('t1', { sessionId: 's9', mcpServer: 'srv' })] } })

    expect(await result).toMatchObject([{ sessionId: 's9', tools: { mcp: { srv: { Bash: 1 } } } }])
  })

  test('an id in sessionIds with no events file and nothing live is skipped', async () => {
    const history = await load(closedSession('s1'), { sessionIds: ['s1', 'ghost'] }).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1'])
  })

  test('a malformed record skips only its session', async () => {
    const malformedTurn = { schema: 1, id: 'x', type: 'turn.complete', ts: 5, sessionId: 's2', agentId: null, branch: null, durationMs: 1 }
    const files: FakeFiles = {
      ...closedSession('s1'),
      'events/s2.jsonl': { content: jsonl([sessionStart({ sessionId: 's2' }), malformedTurn as unknown as ObsEvent]), mtimeMs: STALE_MTIME_MS },
    }

    const history = await load(files).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1'])
  })

  test('forwards liveAgents so a running agent shows the host usage', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart(), spawn('a1')]), mtimeMs: FRESH_MTIME_MS },
      'snapshots/a1.json': { content: JSON.stringify(snapshot('a1', { usage: [usage(10, 0, 0, 0)], costUsd: 0.5 })) },
    }

    const history = await load(files, { liveAgents: { s1: [{ agentId: 'a1', usage: [usage(40, 0, 0, 0)], costUsd: 0.75, hasUnknownPrice: false }] } }).result

    expect(history[0]?.total).toMatchObject({ tokens: 40, costUsd: 0.75 })
  })
})

describe('loadHistory events cache', () => {
  const eventReads = (fake: ReturnType<typeof createFakeFs>) => fake.calls.read.filter((call) => call.path === 'events/s1.jsonl').length

  test('an unchanged live events file is not read again, a changed one is', async () => {
    const eventsCache: EventsCache = new Map()
    const files = closedSession('s1')
    const fake = createFakeFs(files)

    const first = await loadHistory({ fs: fake.fs, eventsCache }, { sessionIds: ['s1'] })
    const second = await loadHistory({ fs: fake.fs, eventsCache }, { sessionIds: ['s1'] })
    expect(eventReads(fake)).toBe(1)
    expect(second).toEqual(first)

    files['events/s1.jsonl'] = { content: jsonl([...closedEvents('s1'), verdict('t1', { sessionId: 's1', mcpServer: 'srv' })]), mtimeMs: STALE_MTIME_MS }
    const third = await loadHistory({ fs: fake.fs, eventsCache }, { sessionIds: ['s1'] })
    expect(eventReads(fake)).toBe(2)
    expect(third[0]?.tools.mcp.srv).toBeDefined()
  })

  test('another session id evicts the cached one, and a load without sessionIds bypasses the cache', async () => {
    const eventsCache: EventsCache = new Map()
    const fake = createFakeFs({ ...closedSession('s1'), ...closedSession('s2') })

    await loadHistory({ fs: fake.fs, eventsCache }, { sessionIds: ['s1'] })
    await loadHistory({ fs: fake.fs, eventsCache }, { sessionIds: ['s2'] })
    expect([...eventsCache.keys()]).toEqual(['s2'])

    await loadHistory({ fs: fake.fs, eventsCache }, {})
    expect([...eventsCache.keys()]).toEqual(['s2'])
  })
})

describe('loadHistory selection', () => {
  const three = { ...closedSession('s1'), ...closedSession('s2'), ...closedSession('s3') }

  test('sessionIds restricts the load to those sessions and equals the full load restricted', async () => {
    const full = await load(three).result
    const { fake, result } = load(three, { sessionIds: ['s1', 's3'] })
    const restricted = await result

    expect(restricted).toEqual(full.filter((session) => session.sessionId !== 's2'))
    expect(fake.readPaths()).not.toContain('events/s2.jsonl')
  })

  test('without sessionIds every retained session loads in ascending id order', async () => {
    const history = await load(three).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1', 's2', 's3'])
  })

  test('modifiedSince skips older sessions without opening their files', async () => {
    const files = { ...closedSession('s1', NOW - 10 * HOUR_MS), ...closedSession('s2', NOW - HOUR_MS) }
    const { fake, result } = load(files, { modifiedSince: NOW - 5 * HOUR_MS })

    expect((await result).map((session) => session.sessionId)).toEqual(['s2'])
    expect(fake.readPaths().filter((path) => path.includes('s1'))).toEqual([])
  })

  test('modifiedSince includes a file modified exactly at it and excludes one a millisecond older', async () => {
    const since = NOW - 5 * HOUR_MS
    const files = { ...closedSession('s1', since - 1), ...closedSession('s2', since) }

    const history = await load(files, { modifiedSince: since }).result

    expect(history.map((session) => session.sessionId)).toEqual(['s2'])
  })

  test('an empty store returns no sessions', async () => {
    expect(await load({}).result).toEqual([])
  })
})

describe('loadHistory fail-open', () => {
  test('skips a session whose read fails and returns the rest', async () => {
    const three = { ...closedSession('s1'), ...closedSession('s2'), ...closedSession('s3') }

    const history = await load(three, {}, ['events/s2.jsonl']).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1', 's3'])
  })

  test('an agent without a snapshot file keeps its row', async () => {
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl(closedEvents('s1')), mtimeMs: STALE_MTIME_MS } }

    const history = await load(files).result

    expect(history[0]?.agents).toHaveLength(1)
  })

  test('drops a malformed snapshot alone and keeps the session', async () => {
    const files = { ...closedSession('s1'), 'snapshots/s1a.json': { content: '{"unexpected":true}' } }

    const history = await load(files).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1'])
  })
})
