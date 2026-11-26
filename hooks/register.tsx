import { atom, update } from 'claude-code'
import type { On, PluginOptions, Register } from 'claude-code'
import { createBranchProvider } from '../capture/branch'
import { RESUME_SWEEP_WINDOW_MS } from '../capture/constants'
import { CLASSIC_PERMISSION_HOOKS_ENABLED } from '../capture/flags'
import { createCapture, type HostApi, type Runtime } from '../capture/handlers'
import type { AgentSnapshot } from '../capture/schema'
import type { StoredSnapshot } from '../capture/snapshots'
import { handleObs, parseObsArgs } from '../commands/obs'
import { handleReport, isReportCommand } from '../commands/report'
import { createBatcher } from '../store/batcher'
import { loadHistory, type HistoryFs } from '../store/load-history'
import { createWriter, WRITE_TIMEOUT_MS, type ProcessRunner } from '../store/writer'
import { registerBand } from '../ui/band'
import { PANE_ID, registerPane } from '../ui/pane'
import { createRefresher, type Refresher } from '../ui/refresher'
import { STATE_SHAPES } from '../ui/state'
import { createLiveLoaders, createSources, type LiveAgentRow } from '../ui/sources'
import type { HistoryAtom, PanelScope, SessionAtom } from '../types'

// The hooks scan reads state refs only from literals or atoms declared in the reading file (see ui/pane.tsx).
const scopeAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })

const BAND_STORE_KEY = 'bandEnabled'

/**
 * Closures over `$`: the plugin validator rejects any use of `$` as a value, so every hook below
 * builds this object inline from `$.noun.event(...)` calls.
 */
type Host = HostApi & {
  run: ProcessRunner
  every: (ms: number, fn: () => void) => { cancel: () => void }
  detect: (path: string) => Promise<{ branch: string | null } | null>
}

const STORE_DIR = '.claude/observability'
const SNAPSHOTS_DIR = `${STORE_DIR}/snapshots`
const SNAPSHOT_EXTENSION = '.json'

type SnapshotFs = {
  home: () => Promise<string | undefined>
  list: (dir: string) => Promise<Array<{ name: string; kind: string; mtimeMs: number }>>
  read: (path: string) => Promise<string>
}

/** Only the fields the sweep reads; a file from an older or damaged write is skipped, not fatal. */
const isSnapshotShape = (value: unknown): value is AgentSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).sessionId === 'string' &&
  typeof (value as Record<string, unknown>).closed === 'boolean'

const listStoredSnapshots = async (fs: SnapshotFs): Promise<StoredSnapshot[]> => {
  try {
    const home = await fs.home()
    if (!home) return []
    const dir = `${home}/${SNAPSHOTS_DIR}`
    const recent = (await fs.list(dir)).filter(
      (entry) =>
        entry.kind === 'file' && entry.name.endsWith(SNAPSHOT_EXTENSION) && Date.now() - entry.mtimeMs <= RESUME_SWEEP_WINDOW_MS,
    )
    const stored = await Promise.all(
      recent.map(async (entry): Promise<StoredSnapshot | null> => {
        try {
          const parsed: unknown = JSON.parse(await fs.read(`${dir}/${entry.name}`))
          if (!isSnapshotShape(parsed)) return null
          return { name: entry.name, mtimeMs: entry.mtimeMs, snapshot: parsed }
        } catch {
          return null
        }
      }),
    )
    return stored.filter((entry) => entry !== null)
  } catch {
    return []
  }
}

/** Roots the store file system at `$HOME/.claude/observability`; without HOME every read fails, which yields the no-data view. */
const historyFsOf = (home: string | undefined, fs: HistoryFs): HistoryFs => {
  if (!home) {
    const unreadable = (): Promise<never> => Promise.reject(new Error('HOME is not set'))
    return { list: unreadable, read: unreadable, readText: unreadable }
  }
  const root = `${home}/${STORE_DIR}`
  return {
    list: (path) => fs.list(`${root}/${path}`),
    read: (path, range) => fs.read(`${root}/${path}`, range),
    readText: (path) => fs.readText(`${root}/${path}`),
  }
}

const runtimeFrom = (host: Host): Runtime => {
  const writer = createWriter(host.run)
  return {
    writer,
    batcher: createBatcher(writer, {
      every: (ms, fn) => {
        const timer = host.every(ms, fn)
        return () => timer.cancel()
      },
    }),
    branch: createBranchProvider({
      detect: async (cwd) => {
        const copy = await host.detect(cwd)
        return copy?.branch ? { branch: copy.branch } : null
      },
      runGit: (argv) => host.run(argv, { timeoutMs: WRITE_TIMEOUT_MS }),
    }),
  }
}

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

/** `classicPermissionHooks` is a parameter so tests can exercise both flag states. */
export const registerHooks = (on: On, options: PluginOptions, classicPermissionHooks: boolean): void => {
  const profile = options.harnessProfile === true
  const retentionDays = typeof options.retentionDays === 'string' ? options.retentionDays : undefined
  const capture = createCapture<Host>({ profile, retentionDays, runtime: runtimeFrom })

  // Live panel state. `$` cannot be a value, so the refresher is built once, lazily, by the first hook that
  // has a `PanelHost` (`session.start` or `/obs`; the same approach as capture's runtime) and shared by every hook.
  let panel: Refresher | undefined
  let paneOpen = false
  let bandOn = true
  let obsRegistered = false
  let lastSession: SessionAtom | null = null
  let lastHistory: HistoryAtom = { status: 'idle' }

  const safeRefresh = (type: string): void => {
    try {
      panel?.requestRefresh(type)
    } catch {
      // A refresh failure must never change what the capture hook returns.
    }
  }

  const ensurePanel = async (host: PanelHost): Promise<void> => {
    const fs = historyFsOf(await host.home(), { list: host.list, read: host.read, readText: host.readText })
    panel ??= createRefresher({
      sources: createSources(
        createLiveLoaders({
          // The panel never writes the store: rollups stay the report command's cache.
          loadSessions: async (options) =>
            (await loadHistory({ fs, writer: { upsert: async () => false } }, { now: Date.now(), ...options })).sessions,
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
            (panes) => void (paneOpen = panes.some((pane) => pane.id === PANE_ID)),
            () => undefined,
          ).then(fn)
        })
        return () => timer.cancel()
      },
      isPaneOpen: () => paneOpen,
      isBandEnabled: () => bandOn,
      getSessionId: () => host.sessionId(),
      session: {
        get: () => lastSession,
        set: (value) => {
          lastSession = value
          void host.setSession(value).catch(() => undefined)
        },
      },
      history: {
        get: () => lastHistory,
        set: (value) => {
          lastHistory = value
          void host.setHistory(value).catch(() => undefined)
        },
      },
      bumpTick: () => void host.bumpTick().catch(() => undefined),
    })
  }

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
          listStoredSnapshots({
            home: () => $.env.get('HOME'),
            list: (dir) => $.fs.list(dir),
            read: (path) => $.fs.read(path),
          }),
      },
      e,
      next,
    )
    if (!obsRegistered) {
      obsRegistered = true
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
      bandOn = (await $.store.get(BAND_STORE_KEY)) !== false
      await update($, bandEnabledAtom, () => bandOn)
      // /clear and resume reuse this plugin instance: drop the previous session's figures before the first refresh.
      lastSession = null
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
  on('session.end', ($, e, next) =>
    capture.sessionEnd(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    ),
  )
  on('session.compact', ($, e, next) =>
    capture.sessionCompact(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    ),
  )
  on('command.run', ($, e, next) =>
    capture.commandRun(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    ),
  )
  // Registered after the capture hook above: it is the outer one, so it still records `/obs` after this one answers.
  on('command.run', { command: 'obs' }, async ($, e, next) => {
    if (isReportCommand(e.args)) {
      const home = await $.env.get('HOME')
      return handleReport({
        fs: historyFsOf(home, {
          list: (path) => $.fs.list(path),
          read: (path, range) => $.fs.read(path, range),
          readText: (path) => $.fs.read(path),
        }),
        writer: createWriter((argv, init) => $.process.run(argv, init)),
        options,
        now: Date.now(),
        columns: e.presentation.columns,
      })
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
    const result = await handleObs(parseObsArgs(e.args), {
      isPaneOpen: async () => (await $.ui.panes()).some((pane) => pane.id === PANE_ID),
      closePane: () => $.ui.close({ id: PANE_ID }),
      openPane: async () => {
        const opened = await $.ui.open({ id: PANE_ID, title: 'Observatory', focus: true, closeOnEscape: true })
        paneOpen = opened.isPlaced
        return opened
      },
      resetScope: async () => void (await update($, scopeAtom, (): PanelScope => 'session')),
      onOpened: () => {
        safeRefresh('obs.open')
        panel?.startTimer()
      },
      setBandEnabled: async (enabled) => {
        bandOn = enabled
        await $.store.set(BAND_STORE_KEY, enabled)
        await update($, bandEnabledAtom, () => enabled)
      },
    })
    return result ?? next(e)
  })
  on('skill.prompt', ($, e, next) =>
    capture.skillPrompt(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    ),
  )
  // The panel observes these events inside capture's hook: a second registration of the same
  // event would be a repeat. Refresh runs after capture records, so the new event is pending.
  on('agent.spawn', async ($, e, next) => {
    const result = await capture.agentSpawn(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    )
    safeRefresh('agent.spawn')
    return result
  })
  on('agent.report', async ($, e, next) => {
    const result = await capture.agentReport(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    )
    safeRefresh('agent.report')
    return result
  })
  on('turn.complete', ($, e, next) =>
    capture.turnComplete(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    ),
  )
  on('session.measure', async ($, e, next) => {
    const result = await capture.sessionMeasure(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    )
    safeRefresh('session.measure')
    return result
  })
  on('tool.check', async ($, e, next) => {
    const result = await capture.toolCheck(
      {
        sessionId: () => $.session.id(),
        usage: () => $.session.usage(),
        agents: () => $.agent.list(),
        run: (argv, init) => $.process.run(argv, init),
        every: (ms, fn) => $.clock.every(ms, fn),
        detect: (path) => $.vcs.detect({ path }),
      },
      e,
      next,
    )
    safeRefresh('tool.check')
    return result
  })

  on('ui.close', { id: PANE_ID }, async (_, e, next) => {
    const result = await next(e)
    paneOpen = false
    panel?.stopTimer()
    return result
  })
  registerPane(on, {
    ensureHistory: () => {
      void panel?.ensureHistory()
    },
  })
  registerBand(on)

  if (classicPermissionHooks) {
    on('classic.PermissionRequest', ($, e, next) =>
      capture.permissionOutcome('prompted')(
        {
          sessionId: () => $.session.id(),
          usage: () => $.session.usage(),
          agents: () => $.agent.list(),
          run: (argv, init) => $.process.run(argv, init),
          every: (ms, fn) => $.clock.every(ms, fn),
          detect: (path) => $.vcs.detect({ path }),
        },
        e,
        next,
      ),
    )
    on('classic.PermissionDenied', ($, e, next) =>
      capture.permissionOutcome('denied')(
        {
          sessionId: () => $.session.id(),
          usage: () => $.session.usage(),
          agents: () => $.agent.list(),
          run: (argv, init) => $.process.run(argv, init),
          every: (ms, fn) => $.clock.every(ms, fn),
          detect: (path) => $.vcs.detect({ path }),
        },
        e,
        next,
      ),
    )
    on('classic.PostToolUse', ($, e, next) =>
      capture.permissionOutcome('completed')(
        {
          sessionId: () => $.session.id(),
          usage: () => $.session.usage(),
          agents: () => $.agent.list(),
          run: (argv, init) => $.process.run(argv, init),
          every: (ms, fn) => $.clock.every(ms, fn),
          detect: (path) => $.vcs.detect({ path }),
        },
        e,
        next,
      ),
    )
    on('classic.PostToolUseFailure', ($, e, next) =>
      capture.permissionOutcome('failed')(
        {
          sessionId: () => $.session.id(),
          usage: () => $.session.usage(),
          agents: () => $.agent.list(),
          run: (argv, init) => $.process.run(argv, init),
          every: (ms, fn) => $.clock.every(ms, fn),
          detect: (path) => $.vcs.detect({ path }),
        },
        e,
        next,
      ),
    )
  }
}

export const register: Register = (on, options) =>
  registerHooks(on, options, CLASSIC_PERMISSION_HOOKS_ENABLED)
