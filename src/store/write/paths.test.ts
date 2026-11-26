import { describe, expect, test } from 'claude-code/testing'
import { validateAppendPath, validateMaintainArgs, validateUpsertPath } from './paths'

const REJECTED_PATHS = [
  '../etc/passwd',
  'events/../x.jsonl',
  'events/../../x.jsonl',
  '-events/a.jsonl',
  'events/-a.jsonl',
  '/etc/passwd',
  '/home/u/.claude/observability/events/a.jsonl',
  'events/sub/a.jsonl',
  'events//a.jsonl',
  './events/a.jsonl',
  'events/./a.jsonl',
  'events/.hidden.jsonl',
  'events/a.json',
  'events/a b.jsonl',
  'events/a$(x).jsonl',
  'events/',
  '',
  'unknown/a.jsonl',
  'prompts-2026-1-01.jsonl',
  'prompts-2026-11-25.json',
  'prompts-2026-11-25.jsonl.bak',
  'events/a.jsonl\n',
]

describe('validateAppendPath', () => {
  test('accepts an events file', () => {
    expect(validateAppendPath('events/abc-123.jsonl')).toEqual({ ok: true, path: 'events/abc-123.jsonl' })
  })

  test('accepts a dated prompts file', () => {
    expect(validateAppendPath('prompts-2026-11-25.jsonl').ok).toBe(true)
  })

  test('rejects snapshots/ and rollup/ targets', () => {
    expect(validateAppendPath('snapshots/a1.json').ok).toBe(false)
    expect(validateAppendPath('rollup/day.json').ok).toBe(false)
  })

  test('rejects traversal, absolute, malformed and unknown paths without throwing', () => {
    expect(REJECTED_PATHS.filter((path) => validateAppendPath(path).ok)).toEqual([])
  })
})

describe('validateUpsertPath', () => {
  test('accepts a snapshot file', () => {
    expect(validateUpsertPath('snapshots/a_1-b.json')).toEqual({ ok: true, path: 'snapshots/a_1-b.json' })
  })

  test('accepts the main snapshot file name', () => {
    expect(validateUpsertPath('snapshots/main-s1.json').ok).toBe(true)
  })

  test('accepts a rollup file', () => {
    expect(validateUpsertPath('rollup/2026-11-25_summary.json')).toEqual({
      ok: true,
      path: 'rollup/2026-11-25_summary.json',
    })
  })

  test('rejects events/ and prompts targets', () => {
    expect(validateUpsertPath('events/a.jsonl').ok).toBe(false)
    expect(validateUpsertPath('prompts-2026-11-25.jsonl').ok).toBe(false)
  })

  test('rejects traversal, leading dash, extra segments and absolute paths', () => {
    for (const path of ['snapshots/../a.json', 'snapshots/-a.json', 'rollup/x/y.json', '/snapshots/a.json', 'snapshots/.a.json']) {
      expect(validateUpsertPath(path).ok).toBe(false)
    }
  })
})

describe('validateMaintainArgs', () => {
  test('accepts digit days and the two current file names', () => {
    expect(validateMaintainArgs('30', 'abc-1.jsonl', 'main-abc-1.json')).toEqual({
      ok: true,
      args: ['30', 'abc-1.jsonl', 'main-abc-1.json'],
    })
  })

  test('rejects non-digit or empty days', () => {
    for (const days of ['', '3 0', '-1', '30; rm', '$(x)', '3.5']) {
      expect(validateMaintainArgs(days, 'a.jsonl', 'main-a.json').ok).toBe(false)
    }
  })

  test('rejects file names that are not plain store names', () => {
    expect(validateMaintainArgs('30', '../a.jsonl', 'main-a.json').ok).toBe(false)
    expect(validateMaintainArgs('30', 'a.jsonl', 'x/main-a.json').ok).toBe(false)
    expect(validateMaintainArgs('30', '-a.jsonl', 'main-a.json').ok).toBe(false)
    expect(validateMaintainArgs('30', 'a.jsonl', 'main-a.jsonl').ok).toBe(false)
  })
})
