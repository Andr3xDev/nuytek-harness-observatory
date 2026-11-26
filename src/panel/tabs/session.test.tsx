import { describe, expect, test } from 'claude-code/testing'
import { historyLines } from './history'
import { sessionLines } from './session'
import { aggregate, agent, context, figure, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const tree = [
  agent('a1', { subagentType: 'planner' }),
  agent('a2', { subagentType: 'builder', parentAgentId: 'a1' }),
]

describe('session tab', () => {
  const session = sessionAtomValue(sessionFigures(tree), aggregate())

  test('shows totals, the main loop with both agents as a tree, and usage by model', () => {
    const text = textOf(sessionLines(context('wide', { session })))
    expect(text).toContain('Tokens: in 5.0k │ out 0 │ total 5.0k │ Cost (est.): $0.50')
    expect(text).not.toContain('Context')
    expect(text).toContain('Agents: 2')
    expect(text).toMatch(/^main /m)
    expect(text).toMatch(/^ {2}planner /m)
    expect(text).toMatch(/^ {4}builder /m)
    expect(text).toMatch(/^m1 .* │ +3\.0k$/m)
  })

  test('an unknown-price total carries the estimate marker and its footnote', () => {
    const priced = sessionAtomValue(sessionFigures([], { total: figure(5000, 0.5, true) }), aggregate())
    const text = textOf(sessionLines(context('wide', { session: priced })))
    expect(text).toContain('Cost (est.): ~$0.50')
    expect(text).toContain('~ estimate')
  })

  test('the totals line counts cached prompt tokens as input', () => {
    const cached = sessionAtomValue(sessionFigures([], { total: { ...figure(0), input: 100, cacheRead: 2000, cacheCreation: 300, output: 600, tokens: 3000 } }), aggregate())
    expect(textOf(sessionLines(context('wide', { session: cached })))).toContain('Tokens: in 2.4k │ out 600 │ total 3.0k')
  })

  test('narrow gives a name line then tokens and cost', () => {
    const text = textOf(sessionLines(context('narrow', { session })))
    expect(text).toContain('planner\n  1.0k · $0.10')
  })

  test('no session data yet is one dim line', () => {
    expect(sessionLines(context('wide'))).toEqual([{ text: 'Waiting for session data...', dim: true }])
  })
})

describe('history tab overview', () => {
  test('shows window, session count, type and model figures, and no issue list', () => {
    const history = {
      status: 'ready' as const,
      aggregate: aggregate({
        sessions: 3,
        byType: [{ ...figure(900, 0.1), type: 'builder', spawns: 2, durationMs: 0, engineStatusMix: {}, spawnShare: 1, tokenShare: 1, avgTokens: 450, avgDurationMs: 0, cacheRatio: null }],
        byModel: [{ model: 'm9', ...figure(900) }],
        byIssue: [{ issue: 'IO-1', ...figure(700, 0.2) }],
      }),
    }
    const text = textOf(historyLines(context('wide', { history })))
    expect(text).toContain('Sessions: 3')
    expect(text).toMatch(/^builder /m)
    expect(text).toMatch(/^m9 /m)
    expect(text).not.toMatch(/IO-1|Top issues/)
  })
})
