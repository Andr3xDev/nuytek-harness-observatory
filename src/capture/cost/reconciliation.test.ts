import { describe, expect, test } from 'claude-code/testing'
import { reconcile, type ReconcileInput } from './reconciliation'

const input = (overrides: Partial<ReconcileInput> = {}): ReconcileInput => ({
  sessionUsd: 2.0,
  hasUnknownPrice: false,
  agents: [{ usd: 0.5 }],
  mainTokens: 100,
  ...overrides,
})

describe('reconcile', () => {
  test('consistent totals are not drifted and expose the signed residual and ledger tokens', () => {
    const result = reconcile(input())
    expect(result.drifted).toBe(false)
    expect(result.driftReasons).toEqual([])
    expect(result.sumAgentsUsd).toBe(0.5)
    expect(result.sessionUsd).toBe(2.0)
    expect(result.mainResidualUsd).toBe(1.5)
    expect(result.mainTokens).toBe(100)
    expect(result).not.toHaveProperty('driftUsd')
  })

  test('agents $2.015 over a $2.00 session stay inside the tolerance', () => {
    const result = reconcile(input({ agents: [{ usd: 2.015 }], mainTokens: 0 }))
    expect(result.drifted).toBe(false)
    expect(result.driftReasons).toEqual([])
  })

  test('agents $2.025 over a $2.00 session drift with agents-exceed-session', () => {
    const result = reconcile(input({ agents: [{ usd: 2.025 }], mainTokens: 0 }))
    expect(result.drifted).toBe(true)
    expect(result.driftReasons).toContain('agents-exceed-session')
  })

  test('unknown price on the session drifts with unknown-price', () => {
    const result = reconcile(input({ hasUnknownPrice: true }))
    expect(result.drifted).toBe(true)
    expect(result.driftReasons).toEqual(['unknown-price'])
  })

  test('unknown price on any agent drifts with unknown-price', () => {
    const result = reconcile(input({ agents: [{ usd: 0.1 }, { usd: 0.1, hasUnknownPrice: true }] }))
    expect(result.driftReasons).toEqual(['unknown-price'])
  })

  test('main tokens without a residual beyond tolerance drift with main-cost-missing', () => {
    const result = reconcile(input({ agents: [{ usd: 2.0 }], mainTokens: 500 }))
    expect(result.drifted).toBe(true)
    expect(result.driftReasons).toEqual(['main-cost-missing'])
  })

  test('zero main tokens never raise main-cost-missing', () => {
    expect(reconcile(input({ agents: [{ usd: 2.0 }], mainTokens: 0 })).driftReasons).toEqual([])
  })

  test('no agents leaves the whole session cost as the residual', () => {
    const result = reconcile(input({ agents: [] }))
    expect(result.sumAgentsUsd).toBe(0)
    expect(result.mainResidualUsd).toBe(2.0)
  })
})
