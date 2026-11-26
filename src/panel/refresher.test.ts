import { describe, expect, test } from 'claude-code/testing'
import type { HistoryAtom, PanelTab, SessionAtom } from '../../types'
import { createRefresher, type RefresherDeps } from './refresher'
import type { HistoryLoad, LiveOverlay, Loaded, SessionLoad, Sources } from './sources'
import { HISTORY_MAX_AGE_MS, LIVE_COALESCE_MS, OPEN_TIMER_MS, REFRESH_MIN_INTERVAL_MS } from './timing'

type Timer = { at: number; period?: number; fn: () => void; cancelled: boolean }

function setup(overrides: { open?: boolean } = {}) {
  let time = 0
  const timers: Timer[] = []
  const state = {
    open: overrides.open ?? true,
    session: null as SessionAtom | null,
    history: { status: 'idle' } as HistoryAtom,
    tick: 0,
    tab: 1 as PanelTab,
    sessionCalls: 0,
    historyCalls: 0,
    sessionResult: (): Loaded<SessionLoad> => ({
      status: 'ready',
      sessionFigures: {} as SessionLoad['sessionFigures'],
      aggregate: { n: state.sessionCalls },
      liveAgentIds: [],
    }),
    historyResult: (): Loaded<HistoryLoad> => ({ status: 'ready', aggregate: { h: state.historyCalls } }),
    live: null as LiveOverlay | null,
    liveReads: 0,
    gate: null as Promise<void> | null,
    sessionIdError: null as Error | null,
    sessionId: 's1',
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
    // The overlay is seeded for `s1` only, like the real loader keeps one session's inputs.
    liveSession: (sessionId) => {
      state.liveReads++
      return sessionId === 's1' ? state.live : null
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
    isOpen: () => state.open,
    getSessionId: () => (state.sessionIdError ? Promise.reject(state.sessionIdError) : state.sessionId),
    session: { get: () => state.session, set: (value) => void (state.session = value) },
    history: { get: () => state.history, set: (value) => void (state.history = value) },
    bumpTick: () => void state.tick++,
    readTab: async () => state.tab,
  }
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
  }
  const advance = async (ms: number) => {
    const target = time + ms
    for (;;) {
      const due = timers.filter((t) => !t.cancelled && t.at <= target).sort((a, b) => a.at - b.at)[0]
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
  test('timer tick increments tick every open-timer interval and reloads', async () => {
    const { refresher, state, advance } = setup()
    refresher.startTimer()
    await advance(OPEN_TIMER_MS)
    expect(state.tick).toBe(1)
    expect(state.sessionCalls).toBe(1)
    await advance(OPEN_TIMER_MS)
    expect(state.tick).toBe(2)
  })

  test('a burst of session.measure within the refresh interval starts one reload plus one trailing', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    refresher.requestRefresh('session.measure')
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.sessionCalls).toBe(1)
    await advance(REFRESH_MIN_INTERVAL_MS - 1)
    expect(state.sessionCalls).toBe(1)
    await advance(1)
    expect(state.sessionCalls).toBe(2)
    await advance(REFRESH_MIN_INTERVAL_MS * 3)
    expect(state.sessionCalls).toBe(2)
  })

  test('tool.check updates the figures from memory with no store read', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    expect(state.sessionCalls).toBe(1)
    await advance(LIVE_COALESCE_MS)
    state.live = { sessionFigures: { live: true } as unknown as LiveOverlay['sessionFigures'], aggregate: { live: true } }
    refresher.requestRefresh('tool.check')
    await settle()
    expect(state.sessionCalls).toBe(1)
    expect(state.session?.sessionFigures).toEqual({ live: true })
    expect(state.session?.aggregate).toEqual({ live: true })
  })

  test('a burst of captured events recomputes once at once and once more after the window', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    state.live = { sessionFigures: {} as LiveOverlay['sessionFigures'], aggregate: {} }
    await advance(LIVE_COALESCE_MS)
    state.liveReads = 0
    for (let i = 0; i < 10; i++) refresher.requestRefresh('tool.check')
    await settle()
    expect(state.liveReads).toBe(1)
    await advance(LIVE_COALESCE_MS)
    expect(state.liveReads).toBe(2)
    await advance(LIVE_COALESCE_MS * 4)
    expect(state.liveReads).toBe(2)
  })

  test('a single captured event leaves no trailing recompute', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    state.live = { sessionFigures: {} as LiveOverlay['sessionFigures'], aggregate: {} }
    await advance(LIVE_COALESCE_MS)
    state.liveReads = 0
    refresher.requestRefresh('tool.check')
    await advance(LIVE_COALESCE_MS * 4)
    expect(state.liveReads).toBe(1)
  })

  test('an unseeded overlay falls back to a store read once a session is shown', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('tool.check')
    await settle()
    expect(state.sessionCalls).toBe(0)
    refresher.requestRefresh('session.measure')
    await settle()
    state.live = null
    await advance(REFRESH_MIN_INTERVAL_MS)
    refresher.requestRefresh('tool.check')
    await settle()
    expect(state.sessionCalls).toBe(2)
  })

  test('after the session id changes the next event reads the store and never writes the old overlay', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    state.live = { sessionFigures: { live: true } as unknown as LiveOverlay['sessionFigures'], aggregate: { live: true } }
    await advance(REFRESH_MIN_INTERVAL_MS)
    state.sessionId = 's2'
    refresher.requestRefresh('tool.check')
    await settle()
    expect(state.sessionCalls).toBe(2)
    expect(state.session?.aggregate).toEqual({ n: 2 })
  })

  test('a request during flight does not overlap and gives one follow-up', async () => {
    const { refresher, state, advance, settle } = setup()
    let release!: () => void
    state.gate = new Promise<void>((resolve) => (release = resolve))
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

  test('panel closed at tick cancels the timer and stops reloads', async () => {
    const { refresher, state, advance } = setup()
    refresher.startTimer()
    state.open = false
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

  test('closed panel ignores every event and reads nothing', async () => {
    const closed = setup({ open: false })
    for (const type of ['tool.check', 'session.measure', 'agent.spawn', 'skill.prompt']) closed.refresher.requestRefresh(type)
    await closed.settle()
    expect(closed.state.sessionCalls).toBe(0)
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

  test('ensureHistory reuses a fresh result and reloads once it is older than the max age', async () => {
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

  test('opening the panel on the restored History tab loads history', async () => {
    const { refresher, state, settle } = setup()
    state.tab = 4
    refresher.requestRefresh('obs.open')
    await settle()
    expect(state.historyCalls).toBe(1)
    expect(state.history.status).toBe('ready')
  })

  test('a timer tick on the History tab reloads stale history', async () => {
    const { refresher, state, advance } = setup()
    state.tab = 4
    refresher.startTimer()
    await advance(OPEN_TIMER_MS)
    expect(state.historyCalls).toBe(1)
    await advance(HISTORY_MAX_AGE_MS)
    expect(state.historyCalls).toBe(2)
  })

  test('a changed session id drops the cached session and history before the next figures', async () => {
    const { refresher, state, advance, settle } = setup()
    refresher.requestRefresh('session.measure')
    await settle()
    state.history = { status: 'ready', aggregate: { h: 0 }, loadedAt: 0 }
    expect(state.session).not.toBeNull()
    await advance(REFRESH_MIN_INTERVAL_MS)

    // A failed read for the new session must not leave the old session's figures standing.
    state.sessionResult = () => ({ status: 'unavailable', reason: 'no data' })
    state.sessionId = 's2'
    refresher.requestRefresh('tool.check')
    await settle()

    expect(state.session).toBeNull()
    expect(state.history).toEqual({ status: 'idle' })
  })

  test('other tabs never start a history load', async () => {
    const { refresher, state, settle } = setup()
    refresher.requestRefresh('obs.open')
    refresher.requestRefresh('timer')
    await settle()
    expect(state.historyCalls).toBe(0)
  })
})
