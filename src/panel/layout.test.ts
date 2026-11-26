import { describe, expect, test } from 'claude-code/testing'
import { formatRow, tierOf } from './layout'

describe('tierOf', () => {
  const cases: [number, 'wide' | 'medium' | 'narrow'][] = [
    [70, 'wide'],
    [69, 'medium'],
    [45, 'medium'],
    [44, 'narrow'],
  ]
  for (const [columns, tier] of cases) {
    test(`maps ${columns} columns to ${tier}`, () => {
      expect(tierOf(columns)).toBe(tier)
    })
  }
})

describe('formatRow', () => {
  const widths = [12, 6, 8]

  test('keeps numeric columns aligned whatever the name length', () => {
    const short = formatRow(['dev', '12k', '$0.40'], widths)
    const long = formatRow(['a-very-long-agent-name', '1.2M', '$12.00'], widths)

    expect(short).toHaveLength(long.length)
    expect(short.endsWith('   12k    $0.40')).toBe(true)
    expect(long.endsWith('  1.2M   $12.00')).toBe(true)
  })

  test('truncates only the name column', () => {
    const row = formatRow(['a-very-long-agent-name', '1.2M', '$12.00'], widths)

    expect(row.startsWith('a-very-long…')).toBe(true)
  })
})
