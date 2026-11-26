import { describe, expect, test } from 'claude-code/testing'
import { resolveRetentionDays } from './retention'

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
