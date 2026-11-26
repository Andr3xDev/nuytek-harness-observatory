import { describe, expect, test } from 'claude-code/testing'
import { historyLines } from './history'
import { aggregate, context, figure, textOf } from './test-kit'

const recent = (startedAt: number) => ({
  ...figure(1500, 0.25),
  output: 500,
  input: 1000,
  type: 'builder',
  model: 'sonnet',
  effort: 'low',
  startedAt,
})

describe('history states', () => {
  test('idle and loading both read as loading', () => {
    for (const status of ['idle', 'loading'] as const) {
      expect(historyLines(context('wide', { history: { status } }))).toEqual([{ text: 'Loading history...', dim: true }])
    }
  })

  test('an unavailable load shows the reason', () => {
    const history = { status: 'unavailable' as const, reason: 'store unreadable' }
    expect(textOf(historyLines(context('wide', { history })))).toBe('History unavailable: store unreadable')
  })

  test('a ready load renders the session count, type and model figures from the history atom', () => {
    const history = {
      status: 'ready' as const,
      aggregate: aggregate({
        sessions: 3,
        byType: [{ ...figure(900, 0.1), type: 'builder', spawns: 2 }],
        byModel: [{ model: 'm9', ...figure(900) }],
      }),
    }
    const text = textOf(historyLines(context('wide', { history })))
    expect(text).toContain('Sessions: 3')
    expect(text).toMatch(/^builder /m)
    expect(text).toMatch(/^m9 /m)
  })
})

describe('history tab agents section', () => {
  test('lists agents by type, model and effort, then the recent runs newest first with In, Out and Total', () => {
    const history = {
      status: 'ready' as const,
      aggregate: aggregate({
        byTypeModelEffort: [{ ...figure(42_000, 0.08), type: 'explorer', model: 'claude-haiku-4-5-20251001', effort: null, spawns: 3 }],
        recentAgents: [recent(Date.UTC(2026, 10, 25, 14, 3)), recent(Date.UTC(2026, 10, 24, 9, 0))],
      }),
    }
    const text = textOf(historyLines(context('wide', { history })))
    expect(text).toContain('By agent type, model and effort')
    expect(text).toMatch(/explorer\s+│\s+haiku-4-5/)
    expect(text).toMatch(/In\s+│\s+Out\s+│\s+Total/)
    expect(text).toContain('Recent runs')
    expect(text).toMatch(/builder\s+│\s+sonnet\s+│\s+○ low\s+│\s+11-25 14:03\s+│\s+1\.0k\s+│\s+500\s+│\s+1\.5k/)
    expect(text.indexOf('11-25 14:03')).toBeLessThan(text.indexOf('11-24 09:00'))
  })
})
