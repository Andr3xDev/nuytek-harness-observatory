import { describe, expect, test } from 'claude-code/testing'
import { buildRetentionArgv, resolveRetentionDays } from './retention'
import { maintainArgv } from './scripts'

describe('resolveRetentionDays', () => {
  for (const days of ['30', '60', '90']) {
    test(`keeps the valid value ${days}`, () => {
      expect(resolveRetentionDays(days)).toBe(days)
    })
  }

  for (const invalid of [undefined, '', '45', 'abc', '30; rm -rf /', '-1']) {
    test(`falls back to 30 for ${JSON.stringify(invalid)}`, () => {
      expect(resolveRetentionDays(invalid)).toBe('30')
    })
  }
})

describe('buildRetentionArgv', () => {
  test('excludes the current events file and main snapshot by name', () => {
    expect(buildRetentionArgv('60', 'sess-1')).toEqual(maintainArgv('60', 'sess-1.jsonl', 'main-sess-1.json'))
  })

  test('an invalid retention value yields the 30 day argv', () => {
    expect(buildRetentionArgv('7', 'sess-1')).toEqual(maintainArgv('30', 'sess-1.jsonl', 'main-sess-1.json'))
  })
})
