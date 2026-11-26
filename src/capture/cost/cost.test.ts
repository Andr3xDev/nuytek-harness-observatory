import { describe, expect, test } from 'claude-code/testing'
import { computeTurnCost, type Reading } from './cost'

const reading = (sessionUsd: number, agents: Record<string, number> = {}, startedAt = 1000): Reading => ({
  startedAt,
  sessionUsd,
  hasUnknownPrice: false,
  agents: new Map(Object.entries(agents)),
})

const NO_LAST_KNOWN = new Map<string, number>()
const near = (actual: number | null, expected: number): void => {
  expect(actual).not.toBeNull()
  expect(Math.abs((actual as number) - expected)).toBeLessThan(1e-9)
}

describe('computeTurnCost', () => {
  test('subtracts the subagent delta from the session delta', () => {
    near(computeTurnCost(reading(1.0, { a1: 0.1 }), reading(1.5, { a1: 0.3 }), NO_LAST_KNOWN), 0.3)
  })

  test('with no subagents equals the full session delta', () => {
    near(computeTurnCost(reading(1.0), reading(1.4), NO_LAST_KNOWN), 0.4)
  })

  test('an agent missing from the baseline counts from zero', () => {
    near(computeTurnCost(reading(1.0), reading(1.5, { a2: 0.2 }), NO_LAST_KNOWN), 0.3)
  })

  test('a vanished agent uses its last known cost', () => {
    const lastKnown = new Map([['a1', 0.5]])
    near(computeTurnCost(reading(1.0, { a1: 0.2 }), reading(1.6), lastKnown), 0.3)
  })

  test('a small negative result clamps to zero', () => {
    expect(computeTurnCost(reading(0.5, { a1: 0 }), reading(1.0, { a1: 0.505 }), NO_LAST_KNOWN)).toBe(0)
  })

  test('a negative result beyond tolerance stays signed', () => {
    near(computeTurnCost(reading(0.5, { a1: 0 }), reading(1.0, { a1: 1.0 }), NO_LAST_KNOWN), -0.5)
  })

  test('startedAt change replaces the baseline with zeros', () => {
    const baseline = reading(9.0, { a1: 4.0 }, 1000)
    near(computeTurnCost(baseline, reading(0.4, { a2: 0.1 }, 2000), NO_LAST_KNOWN), 0.3)
  })

  test('missing end reading gives null', () => {
    expect(computeTurnCost(reading(1.0), null, NO_LAST_KNOWN)).toBeNull()
  })

  test('missing baseline gives null', () => {
    expect(computeTurnCost(null, reading(1.0), NO_LAST_KNOWN)).toBeNull()
  })
})
