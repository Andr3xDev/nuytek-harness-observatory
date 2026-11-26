import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { CTX, report, spawn, turn, usage } from './test-fixtures'

describe('summarizeSession agent rows', () => {
  test('keeps a finished agent and marks an agent without a report as running', () => {
    const figures = summarizeSession({ events: [spawn('a1'), spawn('a2'), report('a1')], snapshots: [] }, CTX)

    expect(figures.agents).toHaveLength(2)
    expect(figures.agents.find((row) => row.agentId === 'a1')?.engineStatus).toBe('completed')
    expect(figures.agents.find((row) => row.agentId === 'a2')?.engineStatus).toBe('running')
  })

  test('uses the last report engineStatus and maps null to unknown', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a1'), report('a1', { engineStatus: 'failed' }), report('a1', { engineStatus: 'stopped' }), spawn('a2'), report('a2', { engineStatus: null })],
        snapshots: [],
      },
      CTX,
    )

    expect(figures.agents.find((row) => row.agentId === 'a1')?.engineStatus).toBe('stopped')
    expect(figures.agents.find((row) => row.agentId === 'a2')?.engineStatus).toBe('unknown')
  })

  test('mainModel is the model of the latest main-loop turn and null without one', () => {
    const events = [turn(null, { usage: usage(1, 1, 0, 0, 'sonnet-x') }), turn(null, { usage: usage(1, 1, 0, 0, 'opus-x') }), turn('a1', { usage: usage(1, 1, 0, 0, 'haiku-x') })]

    expect(summarizeSession({ events, snapshots: [] }, CTX).mainModel).toBe('opus-x')
    expect(summarizeSession({ events: [], snapshots: [] }, CTX).mainModel).toBeNull()
  })

  test('a repeated spawn id gives one row', () => {
    const figures = summarizeSession({ events: [spawn('a1'), spawn('a1')], snapshots: [] }, CTX)

    expect(figures.agents).toHaveLength(1)
  })

  test('keeps parentAgentId as stored while trees list roots only', () => {
    const figures = summarizeSession({ events: [spawn('a'), spawn('b', { parentAgentId: 'a' })], snapshots: [] }, CTX)

    expect(figures.agents.find((row) => row.agentId === 'b')?.parentAgentId).toBe('a')
    expect(figures.trees.map((tree) => tree.rootAgentId)).toEqual(['a'])
  })

  test('sums the turn durations of each agent and of its type', () => {
    const figures = summarizeSession(
      {
        events: [spawn('a1'), spawn('a2'), turn('a1', { durationMs: 20000 }), turn('a1', { durationMs: 10000 }), turn('a2', { durationMs: 30000 }), turn(null, { durationMs: 99999 })],
        snapshots: [],
      },
      CTX,
    )

    expect(figures.agents.find((row) => row.agentId === 'a1')?.durationMs).toBe(30000)
    expect(figures.byType.builder).toMatchObject({ spawns: 2, durationMs: 60000 })
  })
})
