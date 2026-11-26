import type { HistoryAtom, SessionAtom } from '../../types'
import { HISTORY_MAX_AGE_MS, LIVE_COALESCE_MS, OPEN_TIMER_MS, REFRESH_MIN_INTERVAL_MS } from './timing'
import type { Sources } from './sources'

type Cancel = () => void

// Plain function seams: `$` cannot be a value in a plugin, so the call site
// builds these inline from `$.clock` and `$.state`.
export type RefresherDeps = {
  sources: Sources
  now: () => number
  after: (ms: number, fn: () => void) => Cancel
  every: (ms: number, fn: () => void) => Cancel
  isOpen: () => boolean
  getSessionId: () => string | Promise<string>
  session: { get: () => SessionAtom | null; set: (value: SessionAtom) => void }
  history: { get: () => HistoryAtom; set: (value: HistoryAtom) => void }
  bumpTick: () => void
}

// Events that read the store (floored to one read per interval). Any other event only updates the
// figures in memory. A closed panel does nothing: opening it reads the store.
const STORE_READ_EVENTS: ReadonlySet<string> = new Set(['session.measure', 'agent.spawn', 'agent.report', 'timer', 'obs.open'])

export function createRefresher(deps: RefresherDeps) {
  let inFlight = false
  let again = false
  let lastStartedAt: number | null = null
  let cancelTrailing: Cancel | null = null
  let cancelTimer: Cancel | null = null
  let cancelLiveWindow: Cancel | null = null
  let livePending = false

  async function reload(): Promise<void> {
    inFlight = true
    try {
      lastStartedAt = deps.now()
      const result = await deps.sources.loadSessionAggregate(await deps.getSessionId())
      const previous = deps.session.get()
      if (result.status === 'ready') {
        deps.session.set({
          sessionFigures: result.sessionFigures,
          aggregate: result.aggregate,
          liveAgentIds: result.liveAgentIds,
          mainAgent: result.mainAgent ?? null,
          loadedAt: deps.now(),
          error: null,
        })
      } else if (previous) {
        deps.session.set({ ...previous, error: result.reason })
      }
    } catch (error) {
      // Callers fire `reload` without awaiting: a throw here would be an unhandled rejection.
      try {
        const previous = deps.session.get()
        if (previous) deps.session.set({ ...previous, error: error instanceof Error ? error.message : String(error) })
      } catch {
        // Nothing left to record the failure in.
      }
    } finally {
      inFlight = false
      if (again) {
        again = false
        schedule()
      }
    }
  }

  function schedule(): void {
    if (inFlight) {
      again = true
      return
    }
    if (cancelTrailing) return
    const waitMs = lastStartedAt === null ? 0 : lastStartedAt + REFRESH_MIN_INTERVAL_MS - deps.now()
    if (waitMs <= 0) {
      void reload()
      return
    }
    cancelTrailing = deps.after(waitMs, () => {
      cancelTrailing = null
      schedule()
    })
  }

  /** Recomputes the figures from in-memory events; no store read. An unseeded session waits for a store read. */
  async function applyLive(): Promise<void> {
    const live = deps.sources.liveSession(await deps.getSessionId())
    const previous = deps.session.get()
    if (!previous) return
    if (!live) return schedule()
    deps.session.set({ ...previous, sessionFigures: live.sessionFigures, aggregate: live.aggregate })
  }

  // The first event of a burst recomputes at once; the rest of the window collapses into one trailing run.
  function runLive(): void {
    // Rejections stay contained: callers fire this without awaiting.
    void applyLive().catch(() => undefined)
    cancelLiveWindow = deps.after(LIVE_COALESCE_MS, () => {
      cancelLiveWindow = null
      if (!livePending) return
      livePending = false
      if (deps.isOpen()) runLive()
    })
  }

  function requestRefresh(type: string): void {
    if (!deps.isOpen()) return
    if (cancelLiveWindow) livePending = true
    else runLive()
    if (STORE_READ_EVENTS.has(type)) schedule()
  }

  function stopTimer(): void {
    cancelTimer?.()
    cancelTimer = null
  }

  function startTimer(): void {
    if (cancelTimer) return
    cancelTimer = deps.every(OPEN_TIMER_MS, () => {
      if (!deps.isOpen()) {
        stopTimer()
        return
      }
      deps.bumpTick()
      requestRefresh('timer')
    })
  }

  async function ensureHistory(): Promise<void> {
    const current = deps.history.get()
    if (current.status === 'loading') return
    if (current.status === 'ready' && deps.now() - (current.loadedAt ?? 0) < HISTORY_MAX_AGE_MS) return
    deps.history.set({ status: 'loading' })
    const result = await deps.sources.loadHistoryAggregate()
    deps.history.set(
      result.status === 'ready'
        ? { status: 'ready', aggregate: result.aggregate, loadedAt: deps.now() }
        : { status: 'unavailable', reason: result.reason },
    )
  }

  return { requestRefresh, startTimer, stopTimer, ensureHistory }
}

export type Refresher = ReturnType<typeof createRefresher>
