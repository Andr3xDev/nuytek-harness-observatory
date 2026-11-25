import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import type { EventRecord, SessionFigures } from './types'
import { CTX, mainSnapshot, report, sessionEnd, sessionStart, snapshot, spawn, turn, usage } from './test-fixtures'

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

describe('review fixes', () => {
  test('stored-only main turn cost above the snapshot cost wins, with a zero gap and the issue sum intact', () => {
    const figures = summarizeSession(
      {
        events: [turn(null, { branch: ISSUE_BRANCH, usage: TEN_TOKENS, costUsd: 0.75 })],
        snapshots: [mainSnapshot({ usage: [TEN_TOKENS], costUsd: 0.5 })],
      },
      CTX,
    )

    expect(figures.main.costUsd).toBe(0.75)
    expect(figures.coverage.mainCostGapUsd).toBe(0)
    expect(issueCostSum(figures)).toBe(figures.total.costUsd)
  })

  test('a session.measure with an unknown price flags the estimate, also on main issue rows', () => {
    const measure = { ...sessionEnd(), type: 'session.measure', costUsd: 0, hasUnknownPrice: true, context: null, rateLimits: null } as unknown as EventRecord
    const figures = summarizeSession({ events: [measure, turn(null, { branch: ISSUE_BRANCH, usage: TEN_TOKENS, costUsd: 0.25 })], snapshots: [] }, CTX)

    expect(figures.total.hasUnknownPrice).toBe(true)
    expect(figures.byIssue['IO-413']?.hasUnknownPrice).toBe(true)
  })

  test('lastEventAt is the latest event timestamp, open sessions included', () => {
    const figures = summarizeSession({ events: [sessionStart({ ts: 10 }), turn(null, { ts: 40 })], snapshots: [] }, CTX)

    expect(figures.lastEventAt).toBe(40)
  })

  test('an agent.report with an undefined parserVersion counts no status', () => {
    const noVersion = report('a1', { subagentType: 'builder', status: null })
    delete (noVersion as { parserVersion?: unknown }).parserVersion
    const figures = summarizeSession({ events: [sessionStart({ harnessProfile: true }), spawn('a1'), noVersion], snapshots: [] }, CTX)

    expect(figures.profile?.statusMixByType).toEqual({})
  })
})
