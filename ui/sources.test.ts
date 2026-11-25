import { describe, expect, test } from 'claude-code/testing'
import type { SessionFigures } from '../aggregates'
import { UNAVAILABLE_SOURCES, createSources } from './sources'

const figures = { agents: [] } as unknown as SessionFigures

// The no `$.fs` / no store writer rule cannot be a test: a plugin test module may
// import only relative files and "claude-code" (no node:fs). Checked by grep in the task proof.
describe('sources failure wrapper', () => {
  test('ready results pass the loader payload through', async () => {
    const sources = createSources({
      loadSession: async () => ({ sessionFigures: figures, aggregate: { a: 1 }, liveAgentIds: ['x'] }),
      loadHistory: async () => ({ aggregate: { h: 1 } }),
    })
    expect(await sources.loadSessionAggregate('s1')).toEqual({
      status: 'ready',
      sessionFigures: figures,
      aggregate: { a: 1 },
      liveAgentIds: ['x'],
    })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'ready', aggregate: { h: 1 } })
  })

  test('a throwing or rejecting loader yields unavailable and does not throw', async () => {
    const sources = createSources({
      loadSession: () => {
        throw new Error('sync boom')
      },
      loadHistory: () => Promise.reject(new Error('async boom')),
    })
    expect(await sources.loadSessionAggregate('s1')).toEqual({ status: 'unavailable', reason: 'sync boom' })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'unavailable', reason: 'async boom' })
  })

  test('a non-Error rejection keeps a string reason', async () => {
    const sources = createSources({ loadSession: () => Promise.reject('plain'), loadHistory: () => Promise.reject(42) })
    expect(await sources.loadSessionAggregate('s1')).toEqual({ status: 'unavailable', reason: 'plain' })
    expect(await sources.loadHistoryAggregate()).toEqual({ status: 'unavailable', reason: '42' })
  })

  test('the stub sources are unavailable', async () => {
    expect((await UNAVAILABLE_SOURCES.loadSessionAggregate('s1')).status).toBe('unavailable')
    expect((await UNAVAILABLE_SOURCES.loadHistoryAggregate()).status).toBe('unavailable')
  })
})
