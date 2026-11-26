import { atom, update } from 'claude-code'
import type { On, PluginOptions } from 'claude-code'
import type { Capture } from '../capture/register'
import { loadHistory } from '../report/load-history'
import { runReportCommand } from '../report/run'
import { historyFsOf, type HistoryFs } from '../store/read/history-fs'
import { listStoredSnapshots } from '../store/read/snapshot-store'
import type { HistoryAtom, PanelScope, SessionAtom } from '../../types'
import { registerBand } from './band'
import { handleObs, parseObsArgs } from './obs-command'
import { PANE_ID, registerPane } from './pane'
import { createRefresher, type Refresher } from './refresher'
import { createLiveLoaders, createSources, type LiveAgentRow } from './sources'
import { STATE_SHAPES } from './state'

// The hooks scan reads state refs only from literals or atoms declared in the reading file (see pane.tsx).
const scopeAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })

const BAND_STORE_KEY = 'bandEnabled'

/** The slice of `$` the panel needs, as closures built inline by each hook that can create the panel. */
type PanelHost = {
  home: () => Promise<string | undefined>
  list: HistoryFs['list']
  read: HistoryFs['read']
  readText: HistoryFs['readText']
  listAgents: () => Promise<readonly LiveAgentRow[]>
  usage: () => Promise<{ context?: { percent?: number | null; window: number } | null }>
  sessionId: () => Promise<string>
  after: (ms: number, fn: () => void) => { cancel: () => void }
  every: (ms: number, fn: () => void) => { cancel: () => void }
  panes: () => Promise<ReadonlyArray<{ id: string }>>
  setSession: (value: SessionAtom | null) => Promise<unknown>
  setHistory: (value: HistoryAtom) => Promise<unknown>
  bumpTick: () => Promise<unknown>
}

type PanelState = {
  refresher: Refresher | undefined
  paneOpen: boolean
  bandOn: boolean
  obsRegistered: boolean
  lastSession: SessionAtom | null
  lastHistory: HistoryAtom
}

/**
 * Live panel state. `$` cannot be a value, so the refresher is built once, lazily, by the first hook that
 * has a `PanelHost` (`session.start` or `/obs`; the same approach as capture's runtime) and shared by every hook.
 */
export const createPanel = (capture: Capture) => {
  const state: PanelState = { refresher: undefined, paneOpen: false, bandOn: true, obsRegistered: false, lastSession: null, lastHistory: { status: 'idle' } }

  const safeRefresh = (type: string): void => {
    try {
      state.refresher?.requestRefresh(type)
    } catch {
      // A refresh failure must never change what the capture hook returns.
    }
  }

  const ensurePanel = async (host: PanelHost): Promise<void> => {
    const fs = historyFsOf(await host.home(), { list: host.list, read: host.read, readText: host.readText })
    state.refresher ??= createRefresher({
      sources: createSources(
        createLiveLoaders({
          // No writer: the panel never writes the store, rollups stay the report command's cache.
          loadSessions: async (options) => (await loadHistory({ fs }, { now: Date.now(), ...options })).sessions,
          pendingEvents: (sessionId) => capture.pendingEvents(sessionId),
          listAgents: () => host.listAgents(),
          readContext: async () => {
            const { context } = await host.usage()
            return context ? { percent: context.percent ?? null, window: context.window } : null
          },
        }),
      ),
      now: () => Date.now(),
      after: (ms, fn) => {
        const timer = host.after(ms, fn)
        return () => timer.cancel()
      },
      every: (ms, fn) => {
        // `ui.close` covers Esc; an engine-side unload close skips it, so probe the panes before each tick.
        const timer = host.every(ms, () => {
          void host.panes().then(
            (panes) => void (state.paneOpen = panes.some((pane) => pane.id === PANE_ID)),
            () => undefined,
          ).then(fn)
        })
        return () => timer.cancel()
      },
      isPaneOpen: () => state.paneOpen,
      isBandEnabled: () => state.bandOn,
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
export const registerPanel = (on: On, options: PluginOptions, capture: Capture, panel: Panel): void => {
  const { state, safeRefresh, ensurePanel } = panel

  on('session.start', async ($, e, next) => {
    const result = await capture.sessionStart(
      {
        sessionId: () => $.session.id(),
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
          description: 'Toggle the observability pane, or: band on|off, report',
          argumentHint: '[band on|off | report]',
          isTerminalOnly: true,
        })
      } catch {
        // The command is optional: capture and the band keep working without it.
      }
    }
    try {
      state.bandOn = (await $.store.get(BAND_STORE_KEY)) !== false
      await update($, bandEnabledAtom, () => state.bandOn)
      // /clear and resume reuse this plugin instance: drop the previous session's figures before the first refresh.
      state.lastSession = null
      await update($, sessionAtom, () => null)
      await ensurePanel({
        home: () => $.env.get('HOME'),
        list: (path) => $.fs.list(path),
        read: (path, range) => $.fs.read(path, range),
        readText: (path) => $.fs.read(path),
        listAgents: () => $.agent.list(),
        usage: () => $.session.usage(),
        sessionId: () => $.session.id(),
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
        panes: () => $.ui.panes(),
        setSession: (value) => update($, sessionAtom, () => value),
        setHistory: (value) => update($, historyAtom, () => value),
        bumpTick: () => update($, tickAtom, (tick) => tick + 1),
      })
      safeRefresh('session.measure')
    } catch {
      // The panel is optional: a failed setup must not change what session.start returns.
    }
    return result
  })
  on('command.run', { command: 'obs' }, async ($, e, next) => {
    const command = parseObsArgs(e.args)
    if (command === 'report') {
      return runReportCommand(
        {
          home: () => $.env.get('HOME'),
          list: (path) => $.fs.list(path),
          read: (path, range) => $.fs.read(path, range),
          readText: (path) => $.fs.read(path),
          run: (argv, init) => $.process.run(argv, init),
        },
        options,
        e.presentation.columns,
      )
    }
    try {
      // After a plugin reload `session.start` has not run: build the panel here so the pane is not empty forever.
      await ensurePanel({
        home: () => $.env.get('HOME'),
        list: (path) => $.fs.list(path),
        read: (path, range) => $.fs.read(path, range),
        readText: (path) => $.fs.read(path),
        listAgents: () => $.agent.list(),
        usage: () => $.session.usage(),
        sessionId: () => $.session.id(),
        after: (ms, fn) => $.clock.after(ms, fn),
        every: (ms, fn) => $.clock.every(ms, fn),
        panes: () => $.ui.panes(),
        setSession: (value) => update($, sessionAtom, () => value),
        setHistory: (value) => update($, historyAtom, () => value),
        bumpTick: () => update($, tickAtom, (tick) => tick + 1),
      })
    } catch {
      // The panel is optional: /obs still answers without it.
    }
    const result = await handleObs(command, {
      isPaneOpen: async () => (await $.ui.panes()).some((pane) => pane.id === PANE_ID),
      closePane: () => $.ui.close({ id: PANE_ID }),
      openPane: async () => {
        const opened = await $.ui.open({ id: PANE_ID, title: 'Observatory', focus: true, closeOnEscape: true })
        state.paneOpen = opened.isPlaced
        return opened
      },
      resetScope: async () => void (await update($, scopeAtom, (): PanelScope => 'session')),
      onOpened: () => {
        safeRefresh('obs.open')
        state.refresher?.startTimer()
      },
      setBandEnabled: async (enabled) => {
        state.bandOn = enabled
        await $.store.set(BAND_STORE_KEY, enabled)
        await update($, bandEnabledAtom, () => enabled)
      },
    })
    return result ?? next(e)
  })
  on('ui.close', { id: PANE_ID }, async (_, e, next) => {
    const result = await next(e)
    state.paneOpen = false
    state.refresher?.stopTimer()
    return result
  })
  registerPane(on, {
    ensureHistory: () => {
      void state.refresher?.ensureHistory()
    },
  })
  registerBand(on)
}
