import { describe, expect, test } from 'claude-code/testing'
import { parseObsArgs, type ObsCommand } from './obs'

describe('parseObsArgs', () => {
  const cases: [string, ObsCommand][] = [
    ['', 'toggle'],
    ['   ', 'toggle'],
    ['band on', 'band-on'],
    ['  band   on  ', 'band-on'],
    ['band off', 'band-off'],
    ['band  off', 'band-off'],
    ['band', 'band-usage'],
    ['band x', 'band-usage'],
    ['report', 'other'],
    ['foo', 'other'],
    ['band on extra', 'other'],
    ['Band On', 'other'],
  ]
  for (const [args, expected] of cases) {
    test(`parses ${JSON.stringify(args)} as ${expected}`, () => {
      expect(parseObsArgs(args)).toBe(expected)
    })
  }
})
