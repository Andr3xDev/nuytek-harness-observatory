import { describe, expect, test } from 'claude-code/testing'
import { ROLLUP_VERSION } from '../aggregates/rollup'
import { HOUR_MS, NOW, sessionEnd, sessionStart, snapshot, spawn } from '../aggregates/test-fixtures'
import type { SessionRollup } from '../aggregates/types'
import { READ_CONCURRENCY, loadHistory } from './load-history'
import { createFakeFs, createRecordingWriter, jsonl, type FakeFiles } from './test-fs'

const closedSession = (id: string): FakeFiles => ({
  [`events/${id}.jsonl`]: { content: jsonl([sessionStart({ sessionId: id }), spawn(`${id}a`, { sessionId: id }), sessionEnd({ sessionId: id })]), mtimeMs: NOW - 7 * HOUR_MS },
  [`snapshots/${id}a.json`]: { content: JSON.stringify(snapshot(`${id}a`, { sessionId: id })) },
})

const run = (files: FakeFiles, behavior: 'ok' | 'false' | 'throw' = 'ok') => {
  const fake = createFakeFs(files)
  const recorder = createRecordingWriter(files, behavior)
  return { recorder, history: loadHistory({ fs: fake.fs, writer: recorder.writer }, { now: NOW }) }
}

describe('loadHistory rollup write path', () => {
  test('a closed session without a rollup is upserted once with every required field', async () => {
    const { recorder, history } = run(closedSession('s1'))
    const result = await history

    expect(recorder.writes).toHaveLength(1)
    expect(recorder.writes[0]?.path).toBe('rollup/s1.json')
    const rollup = JSON.parse(recorder.writes[0]?.text ?? '') as SessionRollup
    expect(rollup).toMatchObject({ rollupVersion: ROLLUP_VERSION, schemaVersions: [1], sessionId: 's1', state: 'closed', builtAt: NOW })
    expect(rollup.sources.map((source) => source.path).sort()).toEqual(['events/s1.jsonl', 'snapshots/s1a.json'])
    expect(result.sessions).toEqual([rollup.figures])
  })

  test('writes only under rollup/ and concurrently within the read limit', async () => {
    const { recorder, history } = run({ ...closedSession('s1'), ...closedSession('s2'), ...closedSession('s3') })
    await history

    expect(recorder.writes.map((write) => write.path).sort()).toEqual(['rollup/s1.json', 'rollup/s2.json', 'rollup/s3.json'])
    expect(recorder.maxInFlight()).toBeGreaterThan(1)
    expect(recorder.maxInFlight()).toBeLessThanOrEqual(READ_CONCURRENCY)
  })

  test('counts every failed write when several sessions are written at once', async () => {
    const result = await run({ ...closedSession('s1'), ...closedSession('s2') }, 'false').history

    expect(result.rollupWriteFailures).toBe(2)
  })

  test('an invalid session id still yields figures but is never written', async () => {
    const { recorder, history } = run(closedSession('bad.id'))
    const result = await history

    expect(result.sessions).toHaveLength(1)
    expect(recorder.writes).toEqual([])
  })

  test('a corrupt existing rollup is rebuilt and loading does not fail', async () => {
    const files = { ...closedSession('s1'), 'rollup/s1.json': { content: 'not json{' } }

    const { recorder, history } = run(files)
    const result = await history

    expect(result.sessions).toHaveLength(1)
    expect(recorder.writes).toHaveLength(1)
  })

  test('a throwing writer is swallowed, counted, and the figures are still returned', async () => {
    const result = await run(closedSession('s1'), 'throw').history

    expect(result.sessions).toHaveLength(1)
    expect(result.rollupWriteFailures).toBe(1)
  })

  test('a writer that reports failure is counted without affecting the figures', async () => {
    const result = await run(closedSession('s1'), 'false').history

    expect(result.sessions).toHaveLength(1)
    expect(result.rollupWriteFailures).toBe(1)
  })
})
