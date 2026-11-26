import { describe, expect, test } from 'claude-code/testing'
import { capRows, formatRow, tierOf } from './layout'

const rowsOf = (count: number): string[] => Array.from({ length: count }, (_, index) => `row ${index + 1}`)

describe('tierOf', () => {
  const cases: [number, 'wide' | 'medium' | 'narrow'][] = [
    [100, 'wide'],
    [70, 'wide'],
    [69, 'medium'],
    [60, 'medium'],
    [45, 'medium'],
    [44, 'narrow'],
    [40, 'narrow'],
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

describe('capRows', () => {
  test('caps 25 rows to 20 plus "+5 more"', () => {
    const capped = capRows(rowsOf(25), 20)

    expect(capped).toHaveLength(21)
    expect(capped[19]).toBe('row 20')
    expect(capped[20]).toBe('+5 more')
  })

  test('caps 14 bash rows to 10 plus "+4 more"', () => {
    const capped = capRows(rowsOf(14), 10)

    expect(capped).toHaveLength(11)
    expect(capped[10]).toBe('+4 more')
  })

  test('adds no "+N more" line at exactly the cap', () => {
    expect(capRows(rowsOf(20), 20)).toEqual(rowsOf(20))
  })
})
