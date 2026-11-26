import { describe, expect, test } from 'claude-code/testing'
import type { EventRecord } from '../core/figures'
import { createFakeFs, jsonl, type FakeFiles } from '../store/read/test-fs'
import { HOUR_MS, NOW, sessionEnd, sessionStart, snapshot, spawn, turn, usage, verdict } from './analysis/test-fixtures'
import { loadHistory } from './load-history'

const FRESH_MTIME_MS = NOW - 60_000
const STALE_MTIME_MS = NOW - 7 * HOUR_MS

const closedEvents = (id: string): EventRecord[] => [sessionStart({ sessionId: id }), spawn(`${id}a`, { sessionId: id }), sessionEnd({ sessionId: id })]
const agentSnapshotFile = (id: string) => JSON.stringify(snapshot(`${id}a`, { sessionId: id, usage: [usage(10, 0, 0, 0)], costUsd: 0.5 }))

const closedSession = (id: string, mtimeMs = STALE_MTIME_MS): FakeFiles => ({
  [`events/${id}.jsonl`]: { content: jsonl(closedEvents(id)), mtimeMs },
  [`snapshots/${id}a.json`]: { content: agentSnapshotFile(id) },
})

const load = (files: FakeFiles, options: Partial<Parameters<typeof loadHistory>[1]> = {}, failingPaths: string[] = []) => {
  const fake = createFakeFs(files, failingPaths)
  return { fake, result: loadHistory({ fs: fake.fs }, { now: NOW, ...options }) }
}

describe('loadHistory', () => {
  test('counts a line duplicated in the events file once', async () => {
    const dup = turn(null, { sessionId: 's1', id: 'dup', usage: usage(7, 0, 0, 0), costUsd: 0.5 })
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl([sessionStart(), dup, dup, sessionEnd()]), mtimeMs: STALE_MTIME_MS } }

    const history = await load(files).result

    expect(history[0]?.main.input).toBe(7)
  })

  test('classifies an idle session without session.end as stale', async () => {
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl([sessionStart()]), mtimeMs: STALE_MTIME_MS } }

    expect((await load(files).result)[0]?.state).toBe('stale')
  })
})

describe('loadHistory open and live sessions', () => {
  test('computes a running session live', async () => {
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl([sessionStart()]), mtimeMs: FRESH_MTIME_MS } }

    expect((await load(files).result)[0]).toMatchObject({ state: 'open' })
  })

  test('pending events are merged into the stored session', async () => {
    const { result } = load(closedSession('s1'), { pendingEvents: { s1: [verdict('t9', 'allow', { sessionId: 's1', mcpServer: 'srv' })] } })

    expect((await result)[0]?.tools.mcp.srv).toBeDefined()
  })

  test('a session with pending events and no events file is included when named in sessionIds', async () => {
    const { result } = load({}, { sessionIds: ['s9'], pendingEvents: { s9: [sessionStart({ sessionId: 's9' }), verdict('t1', 'allow', { sessionId: 's9', mcpServer: 'srv' })] } })

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
      'events/s2.jsonl': { content: jsonl([sessionStart({ sessionId: 's2' }), malformedTurn as unknown as EventRecord]), mtimeMs: STALE_MTIME_MS },
    }

    const history = await load(files).result

    expect(history.map((session) => session.sessionId)).toEqual(['s1'])
  })

  test('forwards liveAgents so a running agent shows the host usage', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart(), spawn('a1')]), mtimeMs: FRESH_MTIME_MS },
      'snapshots/a1.json': { content: JSON.stringify(snapshot('a1', { usage: [usage(10, 0, 0, 0)], costUsd: 0.5 })) },
    }

    const history = await load(files, { liveAgents: { s1: [{ agentId: 'a1', usage: [usage(40, 0, 0, 0)], costUsd: 0.75 }] } }).result

    expect(history[0]?.total).toMatchObject({ tokens: 40, costUsd: 0.75 })
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

  test('a record with a newer schema is skipped', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart(), { schema: 2, id: 'x', type: 'future' }, sessionEnd()]), mtimeMs: STALE_MTIME_MS },
    }

    const history = await load(files).result

    expect(history[0]?.state).toBe('closed')
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
