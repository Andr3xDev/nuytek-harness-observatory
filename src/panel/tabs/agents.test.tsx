import { describe, expect, test } from 'claude-code/testing'
import type { AggregateFigures } from '../../report/analysis'
import { agentsLines } from './agents'
import { aggregate, agent, context, figure, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const row = (overrides: Partial<AggregateFigures['byTypeModel'][number]> = {}): AggregateFigures['byTypeModel'][number] => ({
  ...figure(42_000, 0.08),
  type: 'explorer',
  model: 'claude-haiku-4-5-20251001',
  spawns: 3,
  ...overrides,
})

const figures = aggregate({ byTypeModel: [row(), row({ model: null, spawns: 1 })] })
const sessionWith = (agg: AggregateFigures) =>
  sessionAtomValue(sessionFigures([agent('a1', { subagentType: 'explorer', model: 'claude-haiku-4-5-20251001' })]), agg)

describe('agents tab', () => {
  test('wide shows one row per type and model with spawns, tokens and cost, and no status', () => {
    const text = textOf(agentsLines(context('wide', { session: sessionWith(figures) })))
    expect(text).toContain('explorer · haiku-4-5')
    expect(text).toContain('3×')
    expect(text).toContain('42k')
    expect(text).toContain('$0.08')
    expect(text).not.toMatch(/Status|done|blocked|Reroutes|Review rounds|harness profile/)
  })

  test('an unknown model renders as ?', () => {
    expect(textOf(agentsLines(context('wide', { session: sessionWith(figures) })))).toContain('explorer · ?')
  })

  test('narrow is two lines per row', () => {
    const text = textOf(agentsLines(context('narrow', { session: sessionWith(figures) })))
    expect(text).toContain('explorer · haiku-4-5\n  3× · 42k · $0.08')
  })

  test('Session scope starts with the main loop row: model left after the agents, tokens and cost', () => {
    const lines = agentsLines(context('wide', { session: sessionWith(figures) }))
    expect(lines[0]?.text).toBe('Agents')
    expect(lines[2]?.text).toContain('main · m1')
    expect(lines[2]?.text).toContain('2.0k')
    expect(lines[2]?.text).toContain('$0.20')
  })

  test('the main row takes the session agent name and falls back to ? without a model', () => {
    const base = sessionAtomValue(sessionFigures([], { byModel: {} }), figures)
    const text = textOf(agentsLines(context('wide', { session: { ...base, mainAgent: 'tech-orchestrator' } })))
    expect(text).toContain('tech-orchestrator · ?')
  })

  test('History scope has no main row', () => {
    const history = { status: 'ready' as const, aggregate: figures }
    expect(textOf(agentsLines(context('wide', { scope: 'history', session: sessionWith(figures), history })))).not.toContain('main')
  })

  test('Session scope lists agents with their id and model; History scope does not', () => {
    const session = sessionWith(figures)
    const lines = agentsLines(context('wide', { session }))
    expect(lines.find(line => line.agentId === 'a1')?.text).toContain('explorer · haiku-4-5')
    const history = { status: 'ready' as const, aggregate: figures }
    expect(agentsLines(context('wide', { scope: 'history', session, history })).some(line => line.agentId !== undefined)).toBe(false)
  })
})
