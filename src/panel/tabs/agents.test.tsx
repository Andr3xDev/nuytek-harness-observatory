import { describe, expect, test } from 'claude-code/testing'
import type { AggregateFigures } from '../../report/analysis'
import { agentsLines } from './agents'
import { aggregate, agent, context, figure, profile, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const builderType = (overrides: Partial<AggregateFigures['byType'][number]> = {}): AggregateFigures['byType'][number] => ({
  ...figure(1000, 0.1),
  type: 'builder',
  spawns: 3,
  durationMs: 0,
  engineStatusMix: {},
  spawnShare: 1,
  tokenShare: 0.25,
  avgTokens: 333,
  avgDurationMs: 61_000,
  cacheRatio: null,
  ...overrides,
})

const sessionWith = (figures: AggregateFigures) => sessionAtomValue(sessionFigures([agent('a1')]), figures)

describe('agents tab', () => {
  const withProfile = aggregate({
    byType: [builderType()],
    profile: profile({ statusMixByType: { builder: { done: 2, blocked: 1 } }, reroutesByType: { builder: 1 }, reviewPasses: 4 }),
  })

  test('wide shows every column and the status mix as counts', () => {
    const text = textOf(agentsLines(context('wide', { session: sessionWith(withProfile) })))
    expect(text).toContain('2 done 1 blocked 0 partial')
    expect(text).toContain('Avg tok')
    expect(text).toContain('Time')
    expect(text).toContain('25%')
    expect(text).toContain('Reroutes')
  })

  test('review rounds are plain information', () => {
    const lines = agentsLines(context('wide', { session: sessionWith(withProfile) }))
    expect(lines.find(line => line.text === 'Review rounds: 4')).toEqual({ text: 'Review rounds: 4' })
  })

  test('medium drops the average-token and duration columns', () => {
    const text = textOf(agentsLines(context('medium', { session: sessionWith(withProfile) })))
    expect(text).not.toContain('Avg tok')
    expect(text).not.toContain('Time')
    expect(text).toContain('2 done 1 blocked 0 partial')
  })

  test('narrow is two lines per type', () => {
    const text = textOf(agentsLines(context('narrow', { session: sessionWith(withProfile) })))
    expect(text).toContain('builder\n  3 · 25% · 2 done 1 blocked 0 partial · 1')
  })

  test('a null profile renders n/a cells, one footnote and no zeros', () => {
    const text = textOf(agentsLines(context('wide', { session: sessionWith(aggregate({ byType: [builderType()] })) })))
    expect(text).toContain('n/a')
    expect(text).not.toContain('0 done')
    expect(text.match(/n\/a: harness profile off/g)).toHaveLength(1)
    expect(text).toContain('Review rounds: n/a (harness profile off)')
  })

  test('Session scope lists agents with their id; History scope does not', () => {
    const session = sessionWith(withProfile)
    expect(agentsLines(context('wide', { session })).some(line => line.agentId === 'a1')).toBe(true)
    const history = { status: 'ready' as const, aggregate: withProfile }
    expect(agentsLines(context('wide', { scope: 'history', session, history })).some(line => line.agentId !== undefined)).toBe(false)
  })
})
