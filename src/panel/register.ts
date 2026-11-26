import { atom, update } from 'claude-code'
import type { On } from 'claude-code'
import type { Capture } from '../capture/register'
import { loadHistory } from '../report/load-history'
import { historyFsOf, type HistoryFs } from '../store/read/history-fs'
import { listStoredSnapshots } from '../store/read/snapshot-store'
import type { HistoryAtom, SessionAtom } from '../../types'
import { registerBand } from './band'
import { handleObs, type ObsDeps } from './obs-command'
import { createRefresher, type Refresher } from './refresher'
import { createLiveLoaders, createSources, type LiveAgentRow } from './sources'
import { STATE_SHAPES } from './state'

// The hooks scan reads state refs only from literals or atoms declared in the reading file (see band.tsx).
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
const panelOpenAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'panelOpen' } as const, false, { shape: STATE_SHAPES.panelOpen })

const PANEL_OPEN_STORE_KEY = 'panelOpen'

/** The slice of `$` the panel needs, as closures built inline by each hook that can create the panel. */
type PanelHost = {
  home: () => Promise<string | undefined>
  list: HistoryFs['list']
  read: HistoryFs['read']
  readText: HistoryFs['readText']
  listAgents: () => Promise<readonly LiveAgentRow[]>
  sessionId: () => Promise<string>
  agentType: () => Promise<string | undefined>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  every: (ms: number, fn: () => void) => { cancel: () => void }
  setSession: (value: SessionAtom | null) => Promise<unknown>
  setHistory: (value: HistoryAtom) => Promise<unknown>
  bumpTick: () => Promise<unknown>
}

type PanelState = {
  refresher: Refresher | undefined
  open: boolean
  obsRegistered: boolean
  lastSession: SessionAtom | null
  lastHistory: HistoryAtom
}

/**
 * Live panel state. `$` cannot be a value, so the refresher is built once, lazily, by the first hook that
 * has a `PanelHost` (`session.start` or `/obs`; the same approach as capture's runtime) and shared by every hook.
 */
export const createPanel = (capture: Capture) => {
  const state: PanelState = { refresher: undefined, open: false, obsRegistered: false, lastSession: null, lastHistory: { status: 'idle' } }

  const safeRefresh = (type: string): void => {
    try {
      state.refresher?.requestRefresh(type)
    } catch {
      // A refresh failure must never change what the capture hook returns.
    }
  }

  const ensurePanel = async (host: PanelHost): Promise<void> => {
    if (state.refresher) return
    const fs = historyFsOf(await host.home(), { list: host.list, read: host.read, readText: host.readText })
    state.refresher = createRefresher({
      sources: createSources(
        createLiveLoaders({
          now: () => Date.now(),
          loadSessions: (options) => loadHistory({ fs }, { now: Date.now(), ...options }),
          pendingEvents: (sessionId) => capture.pendingEvents(sessionId),
          listAgents: () => host.listAgents(),
          readMainAgent: async () => (await host.agentType()) ?? null,
        }),
      ),
      now: () => Date.now(),
      after: (ms, fn) => {
        const timer = host.after(ms, fn)
        return () => timer.cancel()
      },
      every: (ms, fn) => {
        const timer = host.every(ms, fn)
        return () => timer.cancel()
      },
      isOpen: () => state.open,
      getSessionId: () => host.sessionId(),
      session: {
        get: () => state.lastSession,
        set: (value) => {
          state.lastSession = value
          void host.setSession(value).catch(() => undefined)
        },
      },
      history: {
        get: () => state.lastHistory,
        set: (value) => {
          state.lastHistory = value
          void host.setHistory(value).catch(() => undefined)
        },
      },
      bumpTick: () => void host.bumpTick().catch(() => undefined),
    })
  }

  return { state, safeRefresh, ensurePanel }
}

export type Panel = ReturnType<typeof createPanel>

/**
 * Registers the panel's own hooks plus `session.start` (capture's start and the panel setup share
 * that one registration) and `/obs`. Call it after `registerCapture`: the `/obs` hook is then the outer
 * `command.run`, so capture still records `/obs` after this one answers.
 * A top-level function, not a `Panel` method: the validator only lets `on` reach functions named in the module.
 */
export const registerPanel = (on: On, capture: Capture, panel: Panel): void => {
  const { state, safeRefresh, ensurePanel } = panel

  on('session.start', async ($, e, next) => {
    const result = await capture.sessionStart(
      {
        sessionId: () => $.session.id(),
        model: () => $.session.model(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
        listSnapshots: () =>
          listStoredSnapshots(
            {
              home: () => $.env.get('HOME'),
              list: (dir) => $.fs.list(dir),
              read: (path) => $.fs.read(path),
            },
            Date.now(),
          ),
      },
      e,
      next,
    )
    if (!state.obsRegistered) {
      state.obsRegistered = true
      try {
        await $.command.register({
          name: 'obs',
          description: 'Toggle the observability panel',
          isTerminalOnly: true,
        })
      } catch {
        // The command is optional: capture and the panel keep working without it.
      }
    }
    try {
      state.open = (await $.store.get(PANEL_OPEN_STORE_KEY)) === true
      await update($, panelOpenAtom, () => state.open)
      // /clear and resume reuse this plugin instance: drop the previous session's figures before the first refresh.
      state.lastSession = null
      await update($, sessionAtom, () => null)
      await ensurePanel({
        home: () => $.env.get('HOME'),
        list: (path) => $.fs.list(path),
        read: (path, range) => $.fs.read(path, range),
        readText: (path) => $.fs.read(path),
        listAgents: () => $.agent.list(),
        sessionId: () => $.session.id(),
        agentType: async () => (await $.session.info()).agentType,
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
        setSession: (value) => update($, sessionAtom, () => value),
        setHistory: (value) => update($, historyAtom, () => value),
        bumpTick: () => update($, tickAtom, (tick) => tick + 1),
      })
      safeRefresh('session.measure')
      if (state.open) state.refresher?.startTimer()
    } catch {
      // The panel is optional: a failed setup must not change what session.start returns.
    }
    return result
  })
  on('command.run', { command: 'obs' }, async ($, e, next) => {
    if (e.args.trim() !== '') return next(e)
    try {
      // After a plugin reload `session.start` has not run: build the panel here so the band is not empty forever.
      await ensurePanel({
        home: () => $.env.get('HOME'),
        list: (path) => $.fs.list(path),
        read: (path, range) => $.fs.read(path, range),
        readText: (path) => $.fs.read(path),
        listAgents: () => $.agent.list(),
        sessionId: () => $.session.id(),
        agentType: async () => (await $.session.info()).agentType,
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
        setSession: (value) => update($, sessionAtom, () => value),
        setHistory: (value) => update($, historyAtom, () => value),
        bumpTick: () => update($, tickAtom, (tick) => tick + 1),
      })
    } catch {
      // The panel is optional: /obs still answers without it.
    }
    const deps: ObsDeps = {
      isOpen: () => state.open,
      setOpen: async (open) => {
        await $.store.set(PANEL_OPEN_STORE_KEY, open)
        state.open = open
        await update($, panelOpenAtom, () => open)
        if (open) {
          safeRefresh('obs.open')
          state.refresher?.startTimer()
        } else {
          state.refresher?.stopTimer()
        }
      },
    }
    return handleObs(deps)
  })
  registerBand(on, {
    ensureHistory: () => {
      void state.refresher?.ensureHistory()
    },
  })
}
