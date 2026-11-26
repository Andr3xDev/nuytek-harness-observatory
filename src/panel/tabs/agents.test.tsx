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

  test('is one table: the main row with tokens and cost, then the type rows, with no per-agent list', () => {
    const lines = agentsLines(context('wide', { session: sessionWith(figures) }))
    expect(lines[0]?.text).toBe('Agents')
    expect(lines.filter(line => line.text === 'Agents')).toHaveLength(1)
    expect(lines.some(line => line.agentId !== undefined)).toBe(false)
    expect(lines[2]?.text).toMatch(cells('main\\s*', '\\?', '-', '—'))
    expect(lines[2]?.text).toContain('2.0k')
    expect(lines[2]?.text).toContain('$0.20')
    expect(lines[3]?.text).toMatch(cells('explorer\\s*', 'haiku-4-5', '-', '3×'))
  })

  test('the main row takes the session agent name and falls back to ? without a model', () => {
    const base = sessionAtomValue(sessionFigures([]), figures)
    const text = textOf(agentsLines(context('wide', { session: { ...base, mainAgent: 'tech-orchestrator' } })))
    expect(text).toMatch(cells('tech-orchestrator', '\\?', '-'))
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

  test('splits tokens into In, Out and Total', () => {
    expect(agentsLines(context('wide', { session: sessionWith(figures) }))[1]?.text).toMatch(/Spawns\s+│\s+In\s+│\s+Out\s+│\s+Total/)
  })

  test('the main row shows the captured main-loop model', () => {
    const session = sessionAtomValue(sessionFigures([], { mainModel: 'claude-opus-4-1-20250805' }), figures)
    expect(agentsLines(context('wide', { session }))[2]?.text).toMatch(cells('main\\s*', 'opus-4-1', '-'))
  })
})
