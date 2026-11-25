import { describe, expect, test } from 'claude-code/testing'
import { classifySession, summarizeSession } from './session'
import { CTX, HOUR_MS, NOW, mainSnapshot, report, sessionEnd, sessionStart, snapshot, spawn, usage, verdict } from './test-fixtures'

const HUNDRED_TOKENS = usage(10, 20, 30, 40)
const FIFTY_TOKENS = usage(5, 10, 15, 20)

describe('summarizeSession totals', () => {
  test('total is the main snapshot plus every agent snapshot, summed from the usage arrays', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a1')],
        snapshots: [
          mainSnapshot({ usage: [HUNDRED_TOKENS], costUsd: 0.5 }),
          snapshot('a1', { usage: [FIFTY_TOKENS, FIFTY_TOKENS], costUsd: 0.25, tokenCount: 1 }),
        ],
      },
      CTX,
    )

    expect(figures.main).toMatchObject({ tokens: 100, costUsd: 0.5 })
    expect(figures.total).toMatchObject({ tokens: 200, costUsd: 0.75, input: 20, output: 40, cacheRead: 60, cacheCreation: 80 })
  })

  test('flags the cost as an estimate when one agent has an unknown price, without inventing a price', () => {
    const input = (unknownPrice: boolean) => ({
      events: [spawn('a1')],
      snapshots: [snapshot('a1', { usage: [FIFTY_TOKENS], costUsd: 0.25, hasUnknownPrice: unknownPrice })],
    })

    expect(summarizeSession(input(true), CTX).total).toMatchObject({ hasUnknownPrice: true, costUsd: 0.25 })
    expect(summarizeSession(input(false), CTX).total.hasUnknownPrice).toBe(false)
  })
})

describe('summarizeSession delegation trees', () => {
  test('tree total equals the sum of root, child and grandchild', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a'), spawn('b', { parentAgentId: 'a' }), spawn('c', { parentAgentId: 'b' })],
        snapshots: [
          snapshot('a', { usage: [HUNDRED_TOKENS], costUsd: 0.25 }),
          snapshot('b', { usage: [FIFTY_TOKENS], costUsd: 0.5 }),
          snapshot('c', { usage: [FIFTY_TOKENS], costUsd: 0.25 }),
        ],
      },
      CTX,
    )

    expect(figures.trees).toHaveLength(1)
    expect(figures.trees[0]).toMatchObject({ rootAgentId: 'a', tokens: 200, costUsd: 1, agents: 3 })
  })

  test('an agent whose parent is unknown is the root of its own tree', () => {
    const figures = summarizeSession(
      { events: [spawn('x', { parentAgentId: 'ghost' })], snapshots: [snapshot('x', { usage: [FIFTY_TOKENS] })] },
      CTX,
    )

    expect(figures.trees.map((tree) => tree.rootAgentId)).toEqual(['x'])
  })

  test('a parent cycle terminates and keeps both agents in the session total', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a', { parentAgentId: 'b' }), spawn('b', { parentAgentId: 'a' })],
        snapshots: [snapshot('a', { usage: [FIFTY_TOKENS] }), snapshot('b', { usage: [FIFTY_TOKENS] })],
      },
      CTX,
    )

    expect(figures.total.tokens).toBe(100)
  })
})

describe('summarizeSession breakdowns', () => {
  test('separates types by spawn count and models by tokens', () => {
    const figures = summarizeSession(
      {
        events: [spawn('b1'), spawn('b2'), spawn('e1', { subagentType: 'explorer' })],
        snapshots: [
          snapshot('b1', { usage: [usage(10, 0, 0, 0, 'X')] }),
          snapshot('b2', { usage: [usage(20, 0, 0, 0, 'X')] }),
          snapshot('e1', { subagentType: 'explorer', usage: [usage(5, 0, 0, 0, 'Y')] }),
        ],
      },
      CTX,
    )

    expect(figures.byType.builder).toMatchObject({ spawns: 2, tokens: 30 })
    expect(figures.byType.explorer).toMatchObject({ spawns: 1, tokens: 5 })
    expect(figures.byModel.X?.tokens).toBe(30)
    expect(figures.byModel.Y?.tokens).toBe(5)
  })

  test('counts the engine end state per type and maps a null engineStatus to unknown', () => {
    const figures = summarizeSession(
      {
        events: [
          spawn('b1'),
          spawn('b2'),
          spawn('b3'),
          report('b1', { engineStatus: 'completed' }),
          report('b2', { engineStatus: 'failed' }),
          report('b3', { engineStatus: null }),
        ],
        snapshots: [],
      },
      CTX,
    )

    expect(figures.byType.builder?.engineStatusMix).toEqual({ completed: 1, failed: 1, unknown: 1 })
  })

  test('counts a spawn without a snapshot as an agent without snapshot', () => {
    const figures = summarizeSession({ events: [spawn('a1'), spawn('a2')], snapshots: [snapshot('a1')] }, CTX)

    expect(figures.coverage.agentsWithoutSnapshot).toBe(1)
  })
})

describe('summarizeSession denies', () => {
  test('counts only deny verdicts, not ask', () => {
    const verdicts = [
      ...[1, 2, 3, 4].map((n) => verdict(`d${n}`, 'deny')),
      ...[1, 2, 3].map((n) => verdict(`k${n}`, 'ask')),
    ]

    expect(summarizeSession({ events: verdicts, snapshots: [] }, CTX).denies).toBe(4)
  })

  test('counts a deny repeated under the same toolUseId once', () => {
    const figures = summarizeSession({ events: [verdict('t1', 'deny'), verdict('t1', 'deny')], snapshots: [] }, CTX)

    expect(figures.denies).toBe(1)
  })
})

describe('classifySession', () => {
  const start = sessionStart()

  test('is closed when a session.end is present, however old the file is', () => {
    expect(classifySession([start, sessionEnd()], NOW - 100 * HOUR_MS, NOW)).toBe('closed')
  })

  test('is open when idle for just under 6 hours', () => {
    expect(classifySession([start], NOW - (6 * HOUR_MS - 60_000), NOW)).toBe('open')
  })

  test('is stale when idle for more than 6 hours without session.end', () => {
    expect(classifySession([start], NOW - (6 * HOUR_MS + 60_000), NOW)).toBe('stale')
  })
})
