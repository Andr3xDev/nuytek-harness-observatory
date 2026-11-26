import type { HistoryAtom, SessionAtom } from '../types'
import { HISTORY_MAX_AGE_MS, OPEN_TIMER_MS, REFRESH_MIN_INTERVAL_MS } from './state'
import type { Sources } from './sources'

type Cancel = () => void

// Plain function seams: `$` cannot be a value in a plugin, so the call site
// builds these inline from `$.clock`, `$.ui.panes()` and `$.state`.
export type RefresherDeps = {
  sources: Sources
  now: () => number
  after: (ms: number, fn: () => void) => Cancel
  every: (ms: number, fn: () => void) => Cancel
  isPaneOpen: () => boolean
  isBandEnabled: () => boolean
  getSessionId: () => string | Promise<string>
  session: { get: () => SessionAtom | null; set: (value: SessionAtom) => void }
  history: { get: () => HistoryAtom; set: (value: HistoryAtom) => void }
  bumpTick: () => void
}

// Events that still refresh while the pane is closed, for the always-on band.
const CLOSED_PANE_EVENTS: ReadonlySet<string> = new Set(['session.measure', 'agent.spawn', 'agent.report'])

export function createRefresher(deps: RefresherDeps) {
  let inFlight = false
  let again = false
  let lastStartedAt: number | null = null
  let cancelTrailing: Cancel | null = null
  let cancelTimer: Cancel | null = null

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
          context: result.context ?? null,
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

  function requestRefresh(type: string): void {
    if (!deps.isPaneOpen() && !(CLOSED_PANE_EVENTS.has(type) && deps.isBandEnabled())) return
    schedule()
  }

  function stopTimer(): void {
    cancelTimer?.()
    cancelTimer = null
  }

  function startTimer(): void {
    if (cancelTimer) return
    cancelTimer = deps.every(OPEN_TIMER_MS, () => {
      // Esc and the engine close mark never reach our command, so self-heal here.
      if (!deps.isPaneOpen()) {
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
