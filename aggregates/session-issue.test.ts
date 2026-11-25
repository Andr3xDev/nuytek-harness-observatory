import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import type { SessionFigures } from './types'
import { CTX, mainSnapshot, snapshot, spawn, turn, usage } from './test-fixtures'

const ISSUE_BRANCH = 'feature/io-413-audit'
const TEN_TOKENS = usage(10, 0, 0, 0)

const issueCostSum = (figures: SessionFigures): number => Object.values(figures.byIssue).reduce((sum, issue) => sum + issue.costUsd, 0)

describe('per-record issue cost join', () => {
  test('attributes main turns to the branch they ran on', () => {
    const figures = summarizeSession(
      {
        events: [
          turn(null, { branch: 'main', usage: TEN_TOKENS, costUsd: 0.25 }),
          turn(null, { branch: ISSUE_BRANCH, usage: TEN_TOKENS, costUsd: 0.5 }),
        ],
        snapshots: [mainSnapshot({ usage: [TEN_TOKENS, TEN_TOKENS], costUsd: 0.75 })],
      },
      CTX,
    )

    expect(figures.byIssue.unattributed?.costUsd).toBe(0.25)
    expect(figures.byIssue['IO-413']?.costUsd).toBe(0.5)
    expect(issueCostSum(figures)).toBe(figures.total.costUsd)
  })

  test('a turn without cost adds tokens but no cost, and the gap lands in unattributed', () => {
    const figures = summarizeSession(
      {
        events: [turn(null, { branch: ISSUE_BRANCH, usage: TEN_TOKENS, costUsd: null })],
        snapshots: [mainSnapshot({ usage: [TEN_TOKENS], costUsd: 0.25 })],
      },
      CTX,
    )

    expect(figures.byIssue['IO-413']).toMatchObject({ tokens: 10, costUsd: 0 })
    expect(figures.byIssue.unattributed?.costUsd).toBe(0.25)
    expect(figures.coverage.mainCostGapUsd).toBe(0.25)
    expect(issueCostSum(figures)).toBe(figures.total.costUsd)
  })

  test('without a main snapshot main cost is the turn sum and the gap is 0', () => {
    const figures = summarizeSession(
      { events: [turn(null, { branch: ISSUE_BRANCH, usage: TEN_TOKENS, costUsd: 0.25 })], snapshots: [] },
      CTX,
    )

    expect(figures.total.costUsd).toBe(0.25)
    expect(figures.coverage.mainCostGapUsd).toBe(0)
    expect(issueCostSum(figures)).toBe(figures.total.costUsd)
  })

  test('attributes an agent to the branch of its snapshot and keeps the sum equal to the total', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a1')],
        snapshots: [snapshot('a1', { branch: ISSUE_BRANCH, usage: [TEN_TOKENS], costUsd: 0.5 })],
      },
      CTX,
    )

    expect(figures.byIssue['IO-413']).toMatchObject({ tokens: 10, costUsd: 0.5 })
    expect(issueCostSum(figures)).toBe(figures.total.costUsd)
  })

  test('a tree takes its issue from the root spawn branch, not from descendants', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a', { branch: ISSUE_BRANCH }), spawn('b', { parentAgentId: 'a', branch: 'main' })],
        snapshots: [],
      },
      CTX,
    )

    expect(figures.trees[0]?.issue).toBe('IO-413')
  })
})
