import { describe, expect, test } from 'claude-code/testing'
import { findAnomalies } from './analysis/anomalies'
import { combineSessions } from './analysis/combine'
import { summarizeSession } from './analysis/session'
import { CTX, mainSnapshot, sessionEnd, sessionStart, snapshot, spawn, usage } from './analysis/test-fixtures'
import type { SessionFigures } from './analysis/types'
import { DEFAULT_THRESHOLDS, formatReport } from './command'

const RICH_SESSIONS = 12

type SessionOptions = { index: number; harnessProfile?: boolean; unknownPrice?: boolean; withEnd?: boolean }

const session = ({ index, harnessProfile = false, unknownPrice = false, withEnd = true }: SessionOptions): SessionFigures => {
  const sessionId = `s${index}`
  const agentId = `a${index}`
  return summarizeSession(
    {
      events: [
        sessionStart({ sessionId, harnessProfile }),
        spawn(agentId, { sessionId, subagentType: `agent-type-${index % 10}` }),
        ...(withEnd ? [sessionEnd({ sessionId })] : []),
      ],
      snapshots: [
        mainSnapshot({ sessionId, usage: [usage(1000, 0, 0, 0, 'main-model')], costUsd: 0.1, tokenCount: 1000 }),
        snapshot(agentId, {
          sessionId,
          branch: `feature/io-${100 + index}-work`,
          subagentType: `agent-type-${index % 10}`,
          usage: [usage(30000, 500, 1000, 0, `model-${index % 7}`)],
          costUsd: 0.5 + index * 0.25,
          tokenCount: 31500,
          hasUnknownPrice: unknownPrice,
          closed: true,
        }),
      ],
    },
    CTX,
  )
}

const report = (sessions: SessionFigures[], columns?: number): string =>
  formatReport(combineSessions(sessions), findAnomalies(sessions, DEFAULT_THRESHOLDS), columns)

const rich = Array.from({ length: RICH_SESSIONS }, (_, index) => session({ index, harnessProfile: true }))

describe('formatReport', () => {
  test('rich fixture stays within 40 to 60 lines and the column width', () => {
    for (const columns of [80, 100]) {
      const lines = report(rich, columns).split('\n')
      expect(lines.length).toBeGreaterThanOrEqual(40)
      expect(lines.length).toBeLessThanOrEqual(60)
      expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(columns)
    }
  })

  test('has the totals, agent types, models, issues and anomalies sections with +N more collapse', () => {
    const text = report(rich)
    for (const heading of ['Totals', 'Agent types', 'Models (tokens only)', 'Issues by cost', 'Anomalies']) expect(text).toContain(heading)
    expect(text).toContain('+2 more')
  })

  test('no anomalies prints the none-found line', () => {
    const calm = [session({ index: 0 })]
    expect(formatReport(combineSessions(calm), [], 80)).toContain('none found')
  })

  test('profile off prints one n/a line and no zero figures', () => {
    const text = report([session({ index: 0 })])
    expect(text.split('\n').filter((line) => line.includes('n/a (harness profile off)'))).toHaveLength(1)
    expect(text).not.toContain('review passes')
  })

  test('a partial profile names the coverage', () => {
    expect(report([session({ index: 0, harnessProfile: true }), session({ index: 1 })])).toContain('Profile (1 of 2 sessions)')
  })

  test('an unknown price marks the estimate with ~', () => {
    expect(report([session({ index: 0, unknownPrice: true })])).toMatch(/~\$\d+\.\d\d est\./)
    expect(report([session({ index: 0 })])).not.toContain('~$')
  })

  test('a small store has no padded sections and is shorter than the ceiling', () => {
    expect(report([session({ index: 0 })]).split('\n').length).toBeLessThan(25)
  })

  test('an empty store gives a single no-data line', () => {
    expect(report([])).toBe('No sessions recorded yet.')
  })

  test('the most severe anomaly comes first', () => {
    const mild = { kind: 'denies', scope: 'session', sessionId: 'mild', value: 6, threshold: 5 } as const
    const severe = { kind: 'denies', scope: 'session', sessionId: 'severe', value: 50, threshold: 5 } as const
    const lines = formatReport(combineSessions([session({ index: 0 })]), [mild, severe], 80).split('\n')
    expect(lines.filter((line) => line.startsWith('  ! '))).toEqual(['  ! session severe: denies 50 > 5', '  ! session mild: denies 6 > 5'])
  })

  test('an open session is counted in the totals line', () => {
    expect(report([session({ index: 0, withEnd: false })])).toMatch(/1 session \(1 open\)|1 session$/m)
  })
})
