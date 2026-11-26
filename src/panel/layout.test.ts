import { describe, expect, test } from 'claude-code/testing'
import { capRows, formatRow, tabLabels, tierOf, truncate } from './layout'

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

describe('truncate', () => {
  test('cuts at the end with an ellipsis and fills the width', () => {
    expect(truncate('infra-agent-bash-guard', 10)).toBe('infra-age…')
  })

  test('leaves text that fits untouched', () => {
    expect(truncate('short', 10)).toBe('short')
  })
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

describe('tabLabels', () => {
  test('wide uses full labels', () => {
    expect(tabLabels('wide')).toEqual(['1 Session', '2 Agents', '3 Tools', '4 Permissions', '5 History'])
  })

  test('medium and narrow share the short labels', () => {
    const short = ['1 Sess', '2 Agnt', '3 Tool', '4 Perm', '5 Hist']

    expect(tabLabels('medium')).toEqual(short)
    expect(tabLabels('narrow')).toEqual(short)
  })
})
