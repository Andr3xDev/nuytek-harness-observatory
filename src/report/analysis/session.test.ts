import { describe, expect, test } from 'claude-code/testing'
import { classifySession, summarizeSession } from './session'
import { CTX, HOUR_MS, NOW, mainSnapshot, sessionEnd, sessionStart, snapshot, spawn, usage } from './test-fixtures'

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

})

describe('summarizeSession resumed session', () => {
  const [firstEnd, secondEnd] = [sessionEnd({ ts: 100 }), sessionEnd({ ts: 300 })]

  test('start, end, start is not closed and has no endedAt', () => {
    const figures = summarizeSession({ events: [sessionStart({ ts: 50 }), firstEnd, sessionStart({ ts: 200 })], snapshots: [] }, CTX)

    expect(figures.state).toBe('open')
    expect(figures.endedAt).toBeNull()
  })

  test('start, end, start, end is closed at the second end', () => {
    const figures = summarizeSession({ events: [sessionStart({ ts: 50 }), firstEnd, sessionStart({ ts: 200 }), secondEnd], snapshots: [] }, CTX)

    expect(figures.state).toBe('closed')
    expect(figures.endedAt).toBe(300)
  })

  test('start, end stays closed at its end', () => {
    const figures = summarizeSession({ events: [sessionStart({ ts: 50 }), firstEnd], snapshots: [] }, CTX)

    expect(figures.state).toBe('closed')
    expect(figures.endedAt).toBe(100)
  })
})

describe('classifySession', () => {
  const start = sessionStart()

  test('is closed when a session.end is present, however old the file is', () => {
    expect(classifySession([start, sessionEnd()], NOW - 100 * HOUR_MS, NOW)).toBe('closed')
  })

  test('is open when a resume start follows the session.end and the file is fresh', () => {
    expect(classifySession([start, sessionEnd(), sessionStart()], NOW - 60_000, NOW)).toBe('open')
  })

  test('is closed when the resumed session ended again', () => {
    expect(classifySession([start, sessionEnd(), sessionStart(), sessionEnd()], NOW - 100 * HOUR_MS, NOW)).toBe('closed')
  })

  test('is open when idle for just under 6 hours', () => {
    expect(classifySession([start], NOW - (6 * HOUR_MS - 60_000), NOW)).toBe('open')
  })

  test('is stale when idle for more than 6 hours without session.end', () => {
    expect(classifySession([start], NOW - (6 * HOUR_MS + 60_000), NOW)).toBe('stale')
  })
})
