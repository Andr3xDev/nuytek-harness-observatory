import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { mainSnapshot, snapshot, spawn, usage } from './test-fixtures'

const HUNDRED_TOKENS = usage(10, 20, 30, 40)
const FIFTY_TOKENS = usage(5, 10, 15, 20)

describe('summarizeSession totals', () => {
  test('total is the main snapshot plus every agent snapshot, summed from the usage arrays', () => {
    const figures = summarizeSession({
      events: [spawn('a1')],
      snapshots: [
        mainSnapshot({ usage: [HUNDRED_TOKENS], costUsd: 0.5 }),
        snapshot('a1', { usage: [FIFTY_TOKENS, FIFTY_TOKENS], costUsd: 0.25, tokenCount: 1 }),
      ],
    })

    expect(figures.main).toMatchObject({ tokens: 100, costUsd: 0.5 })
    expect(figures.total).toMatchObject({ tokens: 200, costUsd: 0.75, input: 20, output: 40, cacheRead: 60, cacheCreation: 80 })
  })

  test('flags the cost as an estimate when one agent has an unknown price, without inventing a price', () => {
    const input = (unknownPrice: boolean) => ({
      events: [spawn('a1')],
      snapshots: [snapshot('a1', { usage: [FIFTY_TOKENS], costUsd: 0.25, hasUnknownPrice: unknownPrice })],
    })

    expect(summarizeSession(input(true)).total).toMatchObject({ hasUnknownPrice: true, costUsd: 0.25 })
    expect(summarizeSession(input(false)).total.hasUnknownPrice).toBe(false)
  })
})

describe('summarizeSession breakdowns', () => {
  test('separates types by spawn count and models by tokens', () => {
    const figures = summarizeSession({
      events: [spawn('b1'), spawn('b2'), spawn('e1', { subagentType: 'explorer' })],
      snapshots: [
        snapshot('b1', { usage: [usage(10, 0, 0, 0, 'X')] }),
        snapshot('b2', { usage: [usage(20, 0, 0, 0, 'X')] }),
        snapshot('e1', { subagentType: 'explorer', usage: [usage(5, 0, 0, 0, 'Y')] }),
      ],
    })

    expect(figures.byType.builder).toMatchObject({ spawns: 2, tokens: 30 })
    expect(figures.byType.explorer).toMatchObject({ spawns: 1, tokens: 5 })
    expect(figures.byModel.X?.tokens).toBe(30)
    expect(figures.byModel.Y?.tokens).toBe(5)
  })
})
