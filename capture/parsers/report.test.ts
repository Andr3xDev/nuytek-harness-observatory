import { describe, expect, test } from 'claude-code/testing'
import { parseReportStatus } from './report'

describe('parseReportStatus', () => {
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ['status line alone', 'status: done', 'done'],
    ['status line inside a report', 'Findings...\nstatus: partial\nexecutive_summary: x', 'partial'],
    ['blocked value', 'status: blocked', 'blocked'],
    ['no status line', 'All good, nothing to report.', null],
    ['status mid-sentence is not an envelope line', 'the final status: done was reached', null],
    ['empty text', '', null],
  ]

  for (const [name, text, expected] of cases) {
    test(name, () => {
      expect(parseReportStatus(text)).toBe(expected)
    })
  }
})
