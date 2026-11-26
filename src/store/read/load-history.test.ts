import { describe, expect, test } from 'claude-code/testing'
import { buildRollup } from '../../report/analysis/rollup'
import { summarizeSession } from '../../report/analysis/session'
import { CTX, HOUR_MS, NOW, sessionEnd, sessionStart, snapshot, spawn, turn, usage, verdict } from '../../report/analysis/test-fixtures'
import type { EventRecord } from '../../core/figures'
import { loadHistory } from './load-history'
import { createFakeFs, createRecordingWriter, jsonl, type FakeFiles } from './test-fs'

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
  const recorder = createRecordingWriter(files)
  const result = loadHistory({ fs: fake.fs, writer: recorder.writer }, { now: NOW, ...options })
  return { fake, recorder, result }
}

describe('loadHistory rollups', () => {
  test('uses a fresh rollup without reading the events file or writing', async () => {
    const files = closedSession('s1')
    const probe = createFakeFs(files)
    const figures = summarizeSession({ events: closedEvents('s1'), snapshots: [JSON.parse(agentSnapshotFile('s1'))] }, CTX)
    const listing = Object.fromEntries(['events/s1.jsonl', 'snapshots/s1a.json'].map((path) => [path, probe.statOf(path)]))
    files['rollup/s1.json'] = { content: JSON.stringify(buildRollup(figures, listing, 1)) }

    const { fake, recorder, result } = load(files)
    const history = await result

    expect(fake.calls.list).toEqual(['events', 'snapshots'])
    expect(fake.readPaths()).not.toContain('events/s1.jsonl')
    expect(recorder.writes).toEqual([])
    expect(history.sessions).toEqual([figures])
  })

  test('counts a line duplicated in the events file once', async () => {
    const dup = turn(null, { sessionId: 's1', id: 'dup', usage: usage(7, 0, 0, 0), costUsd: 0.5 })
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl([sessionStart(), dup, dup, sessionEnd()]), mtimeMs: STALE_MTIME_MS } }

    const history = await load(files).result

    expect(history.sessions[0]?.main.input).toBe(7)
  })

  test('ignores an orphan rollup whose events file is gone', async () => {
    const files = { ...closedSession('s1'), 'rollup/s5.json': { content: '{}' } }

    const history = await load(files).result

    expect(history.sessions.map((session) => session.sessionId)).toEqual(['s1'])
  })

  test('rebuilds an idle session without session.end as stale, caches it and reuses it next load', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart()]), mtimeMs: STALE_MTIME_MS },
    }

    const first = await load(files).result
    const second = load(files)
    const secondHistory = await second.result

    expect(first.sessions[0]?.state).toBe('stale')
    expect(secondHistory.sessions).toEqual(first.sessions)
    expect(second.fake.readPaths()).not.toContain('events/s1.jsonl')
  })
})

describe('loadHistory open and live sessions', () => {
  test('computes a running session live and never writes a rollup', async () => {
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl([sessionStart(), verdict('t1', 'deny')]), mtimeMs: FRESH_MTIME_MS } }

    const { recorder, result } = load(files)
    const history = await result

    expect(history.sessions[0]).toMatchObject({ state: 'open', denies: 1 })
    expect(recorder.writes).toEqual([])
  })

  test('pending events are merged, bypass a fresh rollup and are never written', async () => {
    const files = closedSession('s1')
    const probe = createFakeFs(files)
    const stored = summarizeSession({ events: closedEvents('s1'), snapshots: [] }, CTX)
    files['rollup/s1.json'] = { content: JSON.stringify(buildRollup(stored, Object.fromEntries(['events/s1.jsonl', 'snapshots/s1a.json'].map((path) => [path, probe.statOf(path)])), 1)) }

    const { fake, recorder, result } = load(files, { pendingEvents: { s1: [verdict('t9', 'deny', { sessionId: 's1' })] } })
    const history = await result

    expect(fake.readPaths()).toContain('events/s1.jsonl')
    expect(history.sessions[0]?.denies).toBe(1)
    expect(recorder.writes).toEqual([])
  })

  test('a session with pending events and no events file is included when named in sessionIds', async () => {
    const { recorder, result } = load({}, { sessionIds: ['s9'], pendingEvents: { s9: [sessionStart({ sessionId: 's9' }), verdict('t1', 'deny', { sessionId: 's9' })] } })
    const history = await result

    expect(history.sessions).toMatchObject([{ sessionId: 's9', denies: 1 }])
    expect(recorder.writes).toEqual([])
  })

  test('an id in sessionIds with no events file and nothing live is skipped', async () => {
    const history = await load(closedSession('s1'), { sessionIds: ['s1', 'ghost'] }).result

    expect(history.sessions.map((session) => session.sessionId)).toEqual(['s1'])
    expect(history.warnings).toBe(0)
  })

  test('a malformed record skips only its session and counts a warning', async () => {
    const malformedTurn = { schema: 1, id: 'x', type: 'turn.complete', ts: 5, sessionId: 's2', agentId: null, branch: null, durationMs: 1 }
    const files: FakeFiles = {
      ...closedSession('s1'),
      'events/s2.jsonl': { content: jsonl([sessionStart({ sessionId: 's2' }), malformedTurn as unknown as EventRecord]), mtimeMs: STALE_MTIME_MS },
    }

    const history = await load(files).result

    expect(history.sessions.map((session) => session.sessionId)).toEqual(['s1'])
    expect(history.warnings).toBe(1)
  })

  test('forwards liveAgents so a running agent shows the host usage', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart(), spawn('a1')]), mtimeMs: FRESH_MTIME_MS },
      'snapshots/a1.json': { content: JSON.stringify(snapshot('a1', { usage: [usage(10, 0, 0, 0)], costUsd: 0.5 })) },
    }

    const history = await load(files, { liveAgents: { s1: [{ agentId: 'a1', usage: [usage(40, 0, 0, 0)], costUsd: 0.75 }] } }).result

    expect(history.sessions[0]?.total).toMatchObject({ tokens: 40, costUsd: 0.75 })
  })
})

describe('loadHistory selection', () => {
  const three = { ...closedSession('s1'), ...closedSession('s2'), ...closedSession('s3') }

  test('sessionIds restricts the load to those sessions and equals the full load restricted', async () => {
    const full = await load(three).result
    const { fake, result } = load(three, { sessionIds: ['s1', 's3'] })
    const restricted = await result

    expect(restricted.sessions).toEqual(full.sessions.filter((session) => session.sessionId !== 's2'))
    expect(fake.readPaths()).not.toContain('events/s2.jsonl')
  })

  test('without sessionIds every retained session loads in ascending id order', async () => {
    const history = await load(three).result

    expect(history.sessions.map((session) => session.sessionId)).toEqual(['s1', 's2', 's3'])
  })

  test('an empty store returns no sessions and no warnings', async () => {
    expect(await load({}).result).toEqual({ sessions: [], warnings: 0, rollupWriteFailures: 0 })
  })
})

describe('loadHistory fail-open', () => {
  test('skips a session whose read fails, counts a warning and returns the rest', async () => {
    const three = { ...closedSession('s1'), ...closedSession('s2'), ...closedSession('s3') }

    const history = await load(three, {}, ['events/s2.jsonl']).result

    expect(history.sessions.map((session) => session.sessionId)).toEqual(['s1', 's3'])
    expect(history.warnings).toBe(1)
  })

  test('counts a newer-schema record as skipped coverage', async () => {
    const files: FakeFiles = {
      'events/s1.jsonl': { content: jsonl([sessionStart(), { schema: 2, id: 'x', type: 'future' }, sessionEnd()]), mtimeMs: STALE_MTIME_MS },
    }

    const history = await load(files).result

    expect(history.sessions[0]?.coverage.skippedNewerSchema).toBe(1)
  })

  test('an agent without a snapshot file is counted as coverage, not a warning', async () => {
    const files: FakeFiles = { 'events/s1.jsonl': { content: jsonl(closedEvents('s1')), mtimeMs: STALE_MTIME_MS } }

    const history = await load(files).result

    expect(history.sessions[0]?.coverage.agentsWithoutSnapshot).toBe(1)
    expect(history.warnings).toBe(0)
  })
})
