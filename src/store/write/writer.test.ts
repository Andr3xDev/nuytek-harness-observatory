import { describe, expect, test } from 'claude-code/testing'
import { appendArgv, initArgv, maintainArgv, upsertArgv } from './scripts'
import { MAINTAIN_TIMEOUT_MS, MAX_WRITE_FAILURES, WRITE_TIMEOUT_MS, createWriter, type ProcessRunner, type RunCall } from './writer'

const OK = { exitCode: 0, stdout: '', stderr: '' }

const recordingRunner = (result: { exitCode: number; stdout: string; stderr: string } = OK) => {
  const calls: RunCall[] = []
  const run: ProcessRunner = async (argv, options) => {
    calls.push({ argv, ...options })
    return result
  }
  return { run, calls }
}

describe('writer', () => {
  test('failures keep only the newest MAX_WRITE_FAILURES entries', async () => {
    let n = 0
    const writer = createWriter(async () => ({ exitCode: 1, stdout: '', stderr: `e${n++}` }))
    for (let i = 0; i < MAX_WRITE_FAILURES + 10; i++) await writer.init()
    expect(writer.failures).toHaveLength(MAX_WRITE_FAILURES)
    expect(writer.failures.at(-1)).toBe(`exit 1: e${MAX_WRITE_FAILURES + 9}`)
    expect(writer.failures[0]).toBe('exit 1: e10')
  })

  test('append runs the fixed append argv with data on stdin and the write timeout', async () => {
    const { run, calls } = recordingRunner()
    const ok = await createWriter(run).append('events/s1.jsonl', '{"a":1}\n')
    expect(ok).toBe(true)
    expect(calls).toEqual([
      { argv: appendArgv('events/s1.jsonl'), stdin: '{"a":1}\n', timeoutMs: WRITE_TIMEOUT_MS },
    ])
  })

  test('init runs the fixed init argv with no stdin; failure is logged, not thrown', async () => {
    const { run, calls } = recordingRunner()
    expect(await createWriter(run).init()).toBe(true)
    expect(calls).toEqual([{ argv: initArgv(), timeoutMs: WRITE_TIMEOUT_MS }])

    const failing = createWriter(async () => {
      throw new Error('spawn failed')
    })
    expect(await failing.init()).toBe(false)
    expect(failing.failures).toHaveLength(1)
    const nonZero = createWriter(recordingRunner({ exitCode: 1, stdout: '', stderr: 'no home' }).run)
    expect(await nonZero.init()).toBe(false)
    expect(nonZero.failures).toEqual(['exit 1: no home'])
  })

  test('upsert runs the fixed upsert argv with the json on stdin', async () => {
    const { run, calls } = recordingRunner()
    const ok = await createWriter(run).upsert('snapshots/a1.json', '{}')
    expect(ok).toBe(true)
    expect(calls).toEqual([{ argv: upsertArgv('snapshots/a1.json'), stdin: '{}', timeoutMs: WRITE_TIMEOUT_MS }])
  })

  test('an invalid path spawns nothing and returns false without throwing', async () => {
    const { run, calls } = recordingRunner()
    const writer = createWriter(run)
    expect(await writer.append('../escape.jsonl', 'x')).toBe(false)
    expect(await writer.append('snapshots/a1.json', 'x')).toBe(false)
    expect(await writer.upsert('events/s1.jsonl', 'x')).toBe(false)
    expect(calls).toEqual([])
  })

  test('maintain uses the maintenance timeout and the fixed maintain argv', async () => {
    const { run, calls } = recordingRunner()
    const ok = await createWriter(run).maintain('30', 's1.jsonl', 'main-s1.json')
    expect(ok).toBe(true)
    expect(calls).toEqual([{ argv: maintainArgv('30', 's1.jsonl', 'main-s1.json'), timeoutMs: MAINTAIN_TIMEOUT_MS }])
  })

  test('maintain with invalid args spawns nothing', async () => {
    const { run, calls } = recordingRunner()
    expect(await createWriter(run).maintain('30; rm -rf /', 's1.jsonl', 'main-s1.json')).toBe(false)
    expect(calls).toEqual([])
  })

  test('a non-zero exit returns false, is logged in memory and does not throw', async () => {
    const { run } = recordingRunner({ exitCode: 1, stdout: '', stderr: 'cd failed' })
    const writer = createWriter(run)
    expect(await writer.append('events/s1.jsonl', 'x')).toBe(false)
    expect(writer.failures).toHaveLength(1)
  })

  test('a rejecting runner (timeout) returns false, is logged and does not throw', async () => {
    const writer = createWriter(async () => {
      throw new Error('timeout')
    })
    expect(await writer.upsert('snapshots/a1.json', '{}')).toBe(false)
    expect(writer.failures).toHaveLength(1)
  })
})
