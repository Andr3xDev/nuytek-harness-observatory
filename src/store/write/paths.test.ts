import { describe, expect, test } from 'claude-code/testing'
import { isValidAppendPath, isValidMaintainArgs, isValidUpsertPath } from './paths'

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

describe('isValidAppendPath', () => {
  test('accepts an events file', () => {
    expect(isValidAppendPath('events/abc-123.jsonl')).toBe(true)
  })

  test('accepts a dated prompts file', () => {
    expect(isValidAppendPath('prompts-2026-11-25.jsonl')).toBe(true)
  })

  test('rejects snapshots/ targets', () => {
    expect(isValidAppendPath('snapshots/a1.json')).toBe(false)
  })

  test('rejects traversal, absolute, malformed and unknown paths without throwing', () => {
    expect(REJECTED_PATHS.filter(isValidAppendPath)).toEqual([])
  })
})

describe('isValidUpsertPath', () => {
  test('accepts a snapshot file', () => {
    expect(isValidUpsertPath('snapshots/a_1-b.json')).toBe(true)
  })

  test('accepts the main snapshot file name', () => {
    expect(isValidUpsertPath('snapshots/main-s1.json')).toBe(true)
  })

  test('rejects events/ and prompts targets', () => {
    expect(isValidUpsertPath('events/a.jsonl')).toBe(false)
    expect(isValidUpsertPath('prompts-2026-11-25.jsonl')).toBe(false)
  })

  test('rejects traversal, leading dash, extra segments and absolute paths', () => {
    for (const path of ['snapshots/../a.json', 'snapshots/-a.json', 'unknown/x/y.json', '/snapshots/a.json', 'snapshots/.a.json']) {
      expect(isValidUpsertPath(path)).toBe(false)
    }
  })
})

describe('isValidMaintainArgs', () => {
  test('accepts digit days and the two current file names', () => {
    expect(isValidMaintainArgs('30', 'abc-1.jsonl', 'main-abc-1.json')).toBe(true)
  })

  test('rejects non-digit or empty days', () => {
    for (const days of ['', '3 0', '-1', '30; rm', '$(x)', '3.5']) {
      expect(isValidMaintainArgs(days, 'a.jsonl', 'main-a.json')).toBe(false)
    }
  })

  test('rejects file names that are not plain store names', () => {
    expect(isValidMaintainArgs('30', '../a.jsonl', 'main-a.json')).toBe(false)
    expect(isValidMaintainArgs('30', 'a.jsonl', 'x/main-a.json')).toBe(false)
    expect(isValidMaintainArgs('30', '-a.jsonl', 'main-a.json')).toBe(false)
    expect(isValidMaintainArgs('30', 'a.jsonl', 'main-a.jsonl')).toBe(false)
  })
})
