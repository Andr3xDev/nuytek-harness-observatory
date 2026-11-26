import { describe, expect, test } from 'claude-code/testing'
import type { AggregateFigures } from '../../report/analysis'
import { agentsLines } from './agents'
import { aggregate, agent, context, figure, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const row = (overrides: Partial<AggregateFigures['byTypeModelEffort'][number]> = {}): AggregateFigures['byTypeModelEffort'][number] => ({
  ...figure(42_000, 0.08),
  type: 'explorer',
  model: 'claude-haiku-4-5-20251001',
  effort: null,
  spawns: 3,
  ...overrides,
})

const figures = aggregate({ byTypeModelEffort: [row(), row({ model: null, spawns: 1 })] })
const sessionWith = (agg: AggregateFigures) =>
  sessionAtomValue(sessionFigures([agent('a1', { subagentType: 'explorer', model: 'claude-haiku-4-5-20251001' })]), agg)

/** Matches adjacent cells of a wide row, whatever the padding between them. */
const cells = (...values: string[]): RegExp => new RegExp(values.join('\\s+│\\s+'))

describe('agents tab', () => {
  test('wide has Agent, Model and Effort columns, with spawns, tokens and cost, and no status', () => {
    const text = textOf(agentsLines(context('wide', { session: sessionWith(figures) })))
    expect(text).toMatch(/Agent\s+│\s+Model\s+│\s+Effort/)
    expect(text).toMatch(cells('explorer\\s*', 'haiku-4-5', '-'))
    expect(text).toContain('3×')
    expect(text).toContain('42k')
    expect(text).toContain('$0.08')
    expect(text).not.toMatch(/Status|done|blocked|Reroutes|Review rounds|harness profile/)
  })

  test('an unknown model renders as ?', () => {
    expect(textOf(agentsLines(context('wide', { session: sessionWith(figures) })))).toMatch(cells('explorer\\s*', '\\?', '-'))
  })

  test('narrow is two lines per row and drops the effort column', () => {
    const text = textOf(agentsLines(context('narrow', { session: sessionWith(figures) })))
    expect(text).toContain('explorer\n  haiku-4-5 · 3× · 42k · $0.08')
  })

  test('Session scope starts with the main loop row: model left after the agents, tokens and cost', () => {
    const lines = agentsLines(context('wide', { session: sessionWith(figures) }))
    expect(lines[0]?.text).toBe('Agents')
    expect(lines[2]?.text).toMatch(cells('main\\s*', 'm1', '-'))
    expect(lines[2]?.text).toContain('2.0k')
    expect(lines[2]?.text).toContain('$0.20')
  })

  test('the main row takes the session agent name and falls back to ? without a model', () => {
    const base = sessionAtomValue(sessionFigures([], { byModel: {} }), figures)
    const text = textOf(agentsLines(context('wide', { session: { ...base, mainAgent: 'tech-orchestrator' } })))
    expect(text).toMatch(cells('tech-orchestrator', '\\?', '-'))
  })

  test('History scope has no main row', () => {
    const history = { status: 'ready' as const, aggregate: figures }
    expect(textOf(agentsLines(context('wide', { scope: 'history', session: sessionWith(figures), history })))).not.toContain('main')
  })

  test('Session scope lists agents with their id and model; History scope does not', () => {
    const session = sessionWith(figures)
    const lines = agentsLines(context('wide', { session }))
    expect(lines.find(line => line.agentId === 'a1')?.text).toMatch(cells('explorer\\s*', 'haiku-4-5'))
    const history = { status: 'ready' as const, aggregate: figures }
    expect(agentsLines(context('wide', { scope: 'history', session, history })).some(line => line.agentId !== undefined)).toBe(false)
  })

  test('effort has its own column with its icon; a budget gets the diamond; none shows a dash', () => {
    const withEffort = aggregate({
      byTypeModelEffort: [row({ effort: 'medium' }), row({ effort: 8000, model: 'claude-opus-4-1' }), row({ effort: 'max', model: 'sonnet' })],
    })
    const text = textOf(agentsLines(context('wide', { session: sessionWith(withEffort) })))
    expect(text).toMatch(cells('explorer\\s*', 'haiku-4-5', '◔ medium'))
    expect(text).toMatch(cells('explorer\\s*', 'opus-4-1', '◇ 8000'))
    expect(text).toMatch(cells('explorer\\s*', 'sonnet', '● max'))
    expect(textOf(agentsLines(context('wide', { session: sessionWith(figures) })))).not.toMatch(/[○◔◑◕●◇]/)
  })

  test('the per-agent list shows the agent effort', () => {
    const session = sessionAtomValue(sessionFigures([agent('a1', { subagentType: 'explorer', model: 'sonnet', effort: 'high' })]), figures)
    expect(textOf(agentsLines(context('wide', { session })))).toMatch(cells('explorer\\s*', 'sonnet', '◑ high'))
  })

  test('History scope adds the recent runs, newest first as given', () => {
    const recent = (agentId: string, startedAt: number) => ({
      sessionId: 's1',
      agentId,
      type: 'builder',
      model: 'sonnet',
      effort: 'low',
      startedAt,
      tokens: 1500,
      costUsd: 0.25,
      hasUnknownPrice: false,
    })
    const aggregateWithRuns = aggregate({ byTypeModelEffort: [row()], recentAgents: [recent('a2', Date.UTC(2026, 10, 25, 14, 3)), recent('a1', Date.UTC(2026, 10, 24, 9, 0))] })
    const history = { status: 'ready' as const, aggregate: aggregateWithRuns }
    const text = textOf(agentsLines(context('wide', { scope: 'history', history })))
    expect(text).toContain('Recent runs')
    expect(text).toMatch(cells('builder\\s*', 'sonnet', '○ low', '11-25 14:03'))
    expect(text.indexOf('11-25 14:03')).toBeGreaterThan(-1)
    expect(text.indexOf('11-25 14:03')).toBeLessThan(text.indexOf('11-24 09:00'))
    expect(text).toContain('1.5k')
  })

  test('stale persisted aggregates without the new lists still render', () => {
    const stale = { ...aggregate(), byTypeModelEffort: undefined, recentAgents: undefined } as unknown as AggregateFigures
    const history = { status: 'ready' as const, aggregate: stale }
    expect(() => agentsLines(context('wide', { scope: 'history', history }))).not.toThrow()
  })
})
