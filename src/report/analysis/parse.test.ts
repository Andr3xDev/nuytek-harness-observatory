import { describe, expect, test } from 'claude-code/testing'
import { sessionStart, turn } from './test-fixtures'
import { parseJsonl } from './parse'

describe('parseJsonl', () => {
  test('keeps earlier lines and drops a truncated last line', () => {
    const first = sessionStart()
    const second = turn(null)
    const truncated = JSON.stringify(turn(null)).slice(0, 20)

    expect(parseJsonl([JSON.stringify(first), JSON.stringify(second), truncated])).toEqual([first, second])
  })

  test('skips a malformed middle line and keeps the rest', () => {
    const first = sessionStart()
    const last = turn(null)

    expect(parseJsonl([JSON.stringify(first), '{not json', JSON.stringify(last)])).toEqual([first, last])
  })

  test('skips a record with a newer schema or without one', () => {
    const supported = sessionStart()
    const newer = { ...turn(null), schema: 2 }

    expect(parseJsonl([JSON.stringify(newer), JSON.stringify({ id: 'x' }), JSON.stringify(supported)])).toEqual([supported])
  })

  test('skips a line without a string type or numeric ts and keeps the session', () => {
    const supported = sessionStart()
    const lines = [{ ...supported, type: undefined }, { ...supported, ts: 'x' }, supported].map((record) => JSON.stringify(record))

    expect(parseJsonl(lines)).toEqual([supported])
  })

  test('returns an empty result for empty input', () => {
    expect(parseJsonl([])).toEqual([])
  })
})
