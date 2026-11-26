import { describe, expect, test } from 'claude-code/testing'
import { resolveRetentionDays } from './retention'

describe('resolveRetentionDays', () => {
  test('keeps each valid value', () => {
    for (const days of ['30', '60', '90']) expect(resolveRetentionDays(days)).toBe(days)
  })

  test('falls back to 30 for anything else, including shell injection', () => {
    for (const invalid of [undefined, '', '45', 'abc', '30; rm -rf /', '-1']) expect(resolveRetentionDays(invalid)).toBe('30')
  })
})
