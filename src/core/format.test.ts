import { describe, expect, test } from 'claude-code/testing'
import { formatFigure, formatTokens, formatUsd, isoDay, truncate } from './format'

describe('formatTokens', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [9900, '9.9k'],
    [10_000, '10k'],
    [412_000, '412k'],
    [1_200_000, '1.2M'],
  ]
  for (const [tokens, label] of cases) {
    test(`renders ${tokens} as ${label}`, () => {
      expect(formatTokens(tokens)).toBe(label)
    })
  }
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

describe('formatFigure', () => {
  test('null is the long profile-off wording in scalar mode', () => {
    expect(formatFigure(null, 'scalar')).toBe('n/a (harness profile off)')
  })

  test('null is bare n/a in cell mode', () => {
    expect(formatFigure(null, 'cell')).toBe('n/a')
  })

  test('a real zero renders 0 in both modes, never n/a', () => {
    expect(formatFigure(0, 'scalar')).toBe('0')
    expect(formatFigure(0, 'cell')).toBe('0')
  })
})
