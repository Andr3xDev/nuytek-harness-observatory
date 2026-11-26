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
  test('wide has Agent, Model and Effort columns, with spawns, split tokens and cost', () => {
    const text = textOf(agentsLines(context('wide', { session: sessionWith(figures) })))
    expect(text).toMatch(/Agent\s+│\s+Model\s+│\s+Effort\s+│\s+Spawns\s+│\s+In\s+│\s+Out\s+│\s+Total/)
    expect(text).toMatch(cells('explorer\\s*', 'haiku-4-5', '-'))
    expect(text).toContain('3×')
    expect(text).toContain('42k')
    expect(text).toContain('$0.08')
  })

  test('narrow is two lines per row and drops the effort column', () => {
    const text = textOf(agentsLines(context('narrow', { session: sessionWith(figures) })))
    expect(text).toContain('explorer\n  haiku-4-5 · 3× · 42k · $0.08')
  })

  test('is one table: the main row first (agent name and model as captured, ? without one), then the type rows', () => {
    const base = sessionAtomValue(sessionFigures([]), figures)
    const withModel = sessionAtomValue(sessionFigures([], { mainModel: 'claude-opus-4-1-20250805' }), figures)
    const cases = [
      { session: sessionWith(figures), main: cells('main\\s*', '\\?', '-', '—') },
      { session: { ...base, mainAgent: 'tech-orchestrator' }, main: cells('tech-orchestrator', '\\?', '-') },
      { session: withModel, main: cells('main\\s*', 'opus-4-1', '-') },
    ]

    for (const { session, main } of cases) {
      const lines = agentsLines(context('wide', { session }))
      expect(lines[0]?.text).toBe('Agents')
      expect(lines[2]?.text).toMatch(main)
      expect(lines[3]?.text).toMatch(cells('explorer\\s*', 'haiku-4-5', '-', '3×'))
      expect(lines[4]?.text).toMatch(cells('explorer\\s*', '\\?', '-'))
    }
    const [defaultLine] = agentsLines(context('wide', { session: sessionWith(figures) })).slice(2)
    expect(defaultLine?.text).toContain('2.0k')
    expect(defaultLine?.text).toContain('$0.20')
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
})
