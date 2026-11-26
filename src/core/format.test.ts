import { describe, expect, test } from 'claude-code/testing'
import { formatTokens, formatUsd, isoDay, truncate } from './format'

describe('formatTokens', () => {
  test('picks the unit and decimals on the rounded value', () => {
    const cases: [number, string][] = [
      [0, '0'],
      [999, '999'],
      [1000, '1.0k'],
      [9_949, '9.9k'],
      [9_999, '10k'],
      [412_000, '412k'],
      [999_499, '999k'],
      [999_500, '1.0M'],
      [1_200_000, '1.2M'],
      [9_999_999, '10M'],
    ]
    for (const [tokens, label] of cases) expect(formatTokens(tokens)).toBe(label)
  })
})

describe('truncate', () => {
  test('cuts at the end with an ellipsis and fills the width', () => {
    expect(truncate('infra-agent-bash-guard', 10)).toBe('infra-age…')
  })

  test('leaves text that fits untouched', () => {
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('isoDay', () => {
  test('renders the UTC calendar day', () => {
    expect(isoDay(Date.UTC(2026, 10, 25, 23, 59))).toBe('2026-11-25')
  })
})

describe('formatUsd', () => {
  test('renders two decimals', () => {
    expect(formatUsd(2.41)).toBe('$2.41')
    expect(formatUsd(0)).toBe('$0.00')
  })
})
