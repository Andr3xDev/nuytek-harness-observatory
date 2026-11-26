import { describe, expect, test } from 'claude-code/testing'
import type { HistoryAtom, SessionAtom } from '../../types'
import { createRefresher, type RefresherDeps } from './refresher'
import type { HistoryLoad, Loaded, SessionLoad, Sources } from './sources'
import { HISTORY_MAX_AGE_MS, OPEN_TIMER_MS, REFRESH_MIN_INTERVAL_MS } from './state'

type Timer = { at: number; period?: number; fn: () => void; cancelled: boolean }

function setup(overrides: { paneOpen?: boolean; bandEnabled?: boolean } = {}) {
  let time = 0
  const timers: Timer[] = []
  const state = {
    paneOpen: overrides.paneOpen ?? true,
    bandEnabled: overrides.bandEnabled ?? true,
    session: null as SessionAtom | null,
    history: { status: 'idle' } as HistoryAtom,
    tick: 0,
    sessionCalls: 0,
    historyCalls: 0,
    sessionResult: (): Loaded<SessionLoad> => ({
      status: 'ready',
      sessionFigures: {} as SessionLoad['sessionFigures'],
      aggregate: { n: state.sessionCalls },
      liveAgentIds: [],
    }),
    historyResult: (): Loaded<HistoryLoad> => ({ status: 'ready', aggregate: { h: state.historyCalls } }),
    gate: null as Promise<void> | null,
    sessionIdError: null as Error | null,
  }
  const sources: Sources = {
    loadSessionAggregate: async () => {
      state.sessionCalls++
      if (state.gate) await state.gate
      return state.sessionResult()
    },
    loadHistoryAggregate: async () => {
      state.historyCalls++
      return state.historyResult()
    },
  }
  const add = (ms: number, fn: () => void, period?: number) => {
    const timer: Timer = { at: time + ms, period, fn, cancelled: false }
    timers.push(timer)
    return () => {
      timer.cancelled = true
    }
  }
  const deps: RefresherDeps = {
    sources,
    now: () => time,
    after: (ms, fn) => add(ms, fn),
    every: (ms, fn) => add(ms, fn, ms),
    isPaneOpen: () => state.paneOpen,
    isBandEnabled: () => state.bandEnabled,
    getSessionId: () => (state.sessionIdError ? Promise.reject(state.sessionIdError) : 's1'),
    session: { get: () => state.session, set: value => void (state.session = value) },
    history: { get: () => state.history, set: value => void (state.history = value) },
    bumpTick: () => void state.tick++,
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    const target = time + ms
    for (;;) {
      const due = timers.filter(t => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      time = due.at
      if (due.period) due.at += due.period
      else due.cancelled = true
      due.fn()
      await settle()
    }
    time = target
    await settle()
  }
  return { refresher: createRefresher(deps), state, advance, settle }
}

describe('refresher', () => {
  test('timer tick increments tick every 5 s and reloads', async () => {
    const { refresher, state, advance } = setup()
    refresher.startTimer()
    await advance(OPEN_TIMER_MS)
    expect(state.tick).toBe(1)
    expect(state.sessionCalls).toBe(1)
    await advance(OPEN_TIMER_MS)
    expect(state.tick).toBe(2)
  })

  test('a burst of tool.check within 3 s starts one reload plus one trailing', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('tool.check')
    refresher.requestRefresh('tool.check')
    refresher.requestRefresh('tool.check')
    await settle()
    expect(state.sessionCalls).toBe(1)
    await advance(REFRESH_MIN_INTERVAL_MS - 1)
    expect(state.sessionCalls).toBe(1)
    await advance(1)
    expect(state.sessionCalls).toBe(2)
    await advance(REFRESH_MIN_INTERVAL_MS * 3)
    expect(state.sessionCalls).toBe(2)
  })

  test('a request during flight does not overlap and gives one follow-up', async () => {
    const { refresher, state, advance, settle } = setup()
    let release!: () => void
    state.gate = new Promise<void>(resolve => (release = resolve))
    refresher.requestRefresh('session.measure')
    await settle()
    refresher.requestRefresh('agent.spawn')
    refresher.requestRefresh('agent.report')
    await settle()
    expect(state.sessionCalls).toBe(1)
    state.gate = null
    release()
    await settle()
    expect(state.sessionCalls).toBe(1)
    await advance(REFRESH_MIN_INTERVAL_MS)
    expect(state.sessionCalls).toBe(2)
    await advance(REFRESH_MIN_INTERVAL_MS * 2)
    expect(state.sessionCalls).toBe(2)
  })

  test('pane gone at tick cancels the timer and stops reloads', async () => {
    const { refresher, state, advance } = setup()
    refresher.startTimer()
    state.paneOpen = false
    await advance(OPEN_TIMER_MS)
    expect(state.tick).toBe(0)
    await advance(OPEN_TIMER_MS * 2)
    expect(state.sessionCalls).toBe(0)
  })

  test('stopTimer ends ticks', async () => {
    const { refresher, state, advance } = setup()
    refresher.startTimer()
    refresher.stopTimer()
    await advance(OPEN_TIMER_MS * 2)
    expect(state.tick).toBe(0)
  })

  test('closed pane ignores tool.check and honors session.measure only with band on', async () => {
    const closed = setup({ paneOpen: false })
    closed.refresher.requestRefresh('tool.check')
    await closed.settle()
    expect(closed.state.sessionCalls).toBe(0)
    closed.refresher.requestRefresh('session.measure')
    await closed.settle()
    expect(closed.state.sessionCalls).toBe(1)

    const bandOff = setup({ paneOpen: false, bandEnabled: false })
    bandOff.refresher.requestRefresh('session.measure')
    await bandOff.settle()
    expect(bandOff.state.sessionCalls).toBe(0)
  })

  test('failed reload keeps the previous atom and sets error', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    const good = state.session
    expect(good?.error).toBeNull()
    state.sessionResult = () => ({ status: 'unavailable', reason: 'disk gone' })
    await advance(REFRESH_MIN_INTERVAL_MS)
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.sessionCalls).toBe(2)
    expect(state.session).toEqual({ ...good, error: 'disk gone' })
  })

  test('a throwing reload is contained: previous atom kept with error, later reloads still run', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    const good = state.session
    state.sessionIdError = new Error('no session')
    await advance(REFRESH_MIN_INTERVAL_MS)
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.session).toEqual({ ...good, error: 'no session' })
    state.sessionIdError = null
    await advance(REFRESH_MIN_INTERVAL_MS)
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.session?.error).toBeNull()
  })

  test('a throwing first reload with no previous atom writes nothing', async () => {
    const { refresher, state, settle } = setup()
    state.sessionIdError = new Error('no session')
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.session).toBeNull()
  })

  test('ensureHistory reuses a fresh result and reloads after 60 s', async () => {
    const { refresher, state, advance } = setup()
    await refresher.ensureHistory()
    await refresher.ensureHistory()
    expect(state.historyCalls).toBe(1)
    expect(state.history.status).toBe('ready')
    await advance(HISTORY_MAX_AGE_MS)
    await refresher.ensureHistory()
    expect(state.historyCalls).toBe(2)
  })

  test('ensureHistory records unavailable and retries on the next call', async () => {
    const { refresher, state } = setup()
    state.historyResult = () => ({ status: 'unavailable', reason: 'no report' })
    await refresher.ensureHistory()
    expect(state.history).toEqual({ status: 'unavailable', reason: 'no report' })
    await refresher.ensureHistory()
    expect(state.historyCalls).toBe(2)
  })
})
