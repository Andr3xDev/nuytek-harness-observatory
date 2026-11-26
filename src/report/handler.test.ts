import { describe, expect, test } from 'claude-code/testing'
import { NOW, sessionEnd, sessionStart, snapshot, spawn, usage } from './analysis/test-fixtures'
import { createFakeFs, createRecordingWriter, jsonl, type FakeFiles } from '../store/read/test-fs'
import { handleReport } from './handler'

const files = (costUsd: number): FakeFiles => ({
  'events/s1.jsonl': { content: jsonl([sessionStart({ sessionId: 's1' }), spawn('a1', { sessionId: 's1' }), sessionEnd({ sessionId: 's1' })]) },
  'snapshots/a1.json': { content: JSON.stringify(snapshot('a1', { sessionId: 's1', usage: [usage(100, 0, 0, 0)], costUsd, tokenCount: 100, closed: true })) },
})

const run = (store: FakeFiles, options = {}) =>
  handleReport({ fs: createFakeFs(store).fs, writer: createRecordingWriter(store).writer, options, now: NOW })

describe('handleReport', () => {
  test('result keys are exactly text and isTextDisplayOnly', async () => {
    const result = await run(files(0.5))
    expect(Object.keys(result).sort()).toEqual(['isTextDisplayOnly', 'text'])
    expect(result.isTextDisplayOnly).toBe(true)
  })

  test('an empty store returns the no-data line and does not throw', async () => {
    expect((await run({})).text).toBe('No sessions recorded yet.')
  })

  test('a 1.40 USD tree is flagged by default and not with a threshold of 2', async () => {
    expect((await run(files(1.4))).text).toContain('cost $1.40 > $1.00')
    expect((await run(files(1.4), { anomalyDelegationCostUsd: 2 })).text).toContain('none found')
  })

  test('only rollups are written', async () => {
    const store = files(0.5)
    const recorder = createRecordingWriter(store)
    await handleReport({ fs: createFakeFs(store).fs, writer: recorder.writer, options: {}, now: NOW })
    expect(recorder.writes.map((write) => write.path)).toEqual(['rollup/s1.json'])
  })

  test('columns narrow the report', async () => {
    const lines = (await handleReport({ fs: createFakeFs(files(1.4)).fs, writer: createRecordingWriter().writer, options: {}, now: NOW, columns: 30 })).text.split('\n')
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(30)
  })
})
