import { describe, expect, test } from 'claude-code/testing'
import { historyLines } from './history'
import { aggregate, context, figure, textOf } from './test-kit'

const recent = (agentId: string, startedAt: number) => ({
  ...figure(1500, 0.25),
  output: 500,
  input: 1000,
  sessionId: 's1',
  agentId,
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
    const history = { status: 'unavailable' as const, reason: 'report aggregates not available' }
    expect(textOf(historyLines(context('wide', { history })))).toBe('History unavailable: report aggregates not available')
  })

  test('a ready load renders the overview from the history atom', () => {
    const history = { status: 'ready' as const, aggregate: aggregate({ sessions: 7 }) }
    expect(textOf(historyLines(context('wide', { history })))).toContain('Sessions: 7')
  })
})

describe('history tab agents section', () => {
  test('lists agents by type, model and effort, then the recent runs newest first with In, Out and Total', () => {
    const history = {
      status: 'ready' as const,
      aggregate: aggregate({
        byTypeModelEffort: [{ ...figure(42_000, 0.08), type: 'explorer', model: 'claude-haiku-4-5-20251001', effort: null, spawns: 3 }],
        recentAgents: [recent('a2', Date.UTC(2026, 10, 25, 14, 3)), recent('a1', Date.UTC(2026, 10, 24, 9, 0))],
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
