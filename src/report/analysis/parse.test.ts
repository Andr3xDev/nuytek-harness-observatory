import { describe, expect, test } from 'claude-code/testing'
import { sessionStart, turn } from './test-fixtures'
import { parseJsonl } from './parse'

describe('parseJsonl', () => {
  test('keeps earlier lines and counts a truncated last line as malformed', () => {
    const first = sessionStart()
    const second = turn(null)
    const truncated = JSON.stringify(turn(null)).slice(0, 20)

    const result = parseJsonl([JSON.stringify(first), JSON.stringify(second), truncated])

    expect(result.records).toEqual([first, second])
    expect(result.skippedMalformed).toBe(1)
  })

  test('skips a malformed middle line and keeps the rest', () => {
    const first = sessionStart()
    const last = turn(null)

    const result = parseJsonl([JSON.stringify(first), '{not json', JSON.stringify(last)])

    expect(result.records).toEqual([first, last])
    expect(result.skippedMalformed).toBe(1)
  })

  test('skips a record with a newer schema and counts it apart from malformed', () => {
    const supported = sessionStart()
    const newer = { ...turn(null), schema: 2 }

    const result = parseJsonl([JSON.stringify(newer), JSON.stringify(supported)])

    expect(result.records).toEqual([supported])
    expect(result.skippedNewerSchema).toBe(1)
    expect(result.skippedMalformed).toBe(0)
  })

  test('returns an empty result for empty input', () => {
    expect(parseJsonl([])).toEqual({ records: [], skippedNewerSchema: 0, skippedMalformed: 0 })
  })
})
