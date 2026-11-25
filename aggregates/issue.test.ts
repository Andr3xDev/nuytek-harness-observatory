import { describe, expect, test } from 'claude-code/testing'
import { cacheRatio, issueKeyOf } from './issue'

describe('issueKeyOf', () => {
  const cases: Array<[string | null, string]> = [
    ['feature/io-421-repo-plantilla', 'IO-421'],
    ['fix/IO-7', 'IO-7'],
    ['feature/013-alerts-observability', 'branch:feature/013-alerts-observability'],
    ['tmp/006-cleanup', 'branch:tmp/006-cleanup'],
    ['fix/oidc-subject-claim', 'branch:fix/oidc-subject-claim'],
    ['main', 'unattributed'],
    ['master', 'unattributed'],
    ['dev', 'unattributed'],
    ['HEAD', 'unattributed'],
    [null, 'unattributed'],
    ['', 'unattributed'],
  ]

  for (const [branch, expected] of cases) {
    test(`maps ${JSON.stringify(branch)} to ${expected}`, () => {
      expect(issueKeyOf(branch)).toBe(expected)
    })
  }
})

describe('cacheRatio', () => {
  test('divides cacheRead by input plus cacheRead plus cacheCreation', () => {
    expect(cacheRatio({ input: 10000, output: 999, cacheRead: 30000, cacheCreation: 10000 })).toBe(0.6)
  })

  test('returns null, not 0, when the denominator is zero', () => {
    expect(cacheRatio({ input: 0, output: 5, cacheRead: 0, cacheCreation: 0 })).toBeNull()
  })
})
