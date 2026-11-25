import type { On, PluginOptions, Register } from 'claude-code'
import { createBranchProvider } from '../capture/branch'
import { RESUME_SWEEP_WINDOW_MS } from '../capture/constants'
import { CLASSIC_PERMISSION_HOOKS_ENABLED } from '../capture/flags'
import { createCapture, type HostApi, type Runtime } from '../capture/handlers'
import type { AgentSnapshot } from '../capture/schema'
import type { StoredSnapshot } from '../capture/snapshots'
import { createBatcher } from '../store/batcher'
import { createWriter, WRITE_TIMEOUT_MS, type ProcessRunner } from '../store/writer'

/**
 * Closures over `$`: the plugin validator rejects any use of `$` as a value, so every hook below
 * builds this object inline from `$.noun.event(...)` calls.
 */
type Host = HostApi & {
  run: ProcessRunner
  every: (ms: number, fn: () => void) => { cancel: () => void }
  detect: (path: string) => Promise<{ branch: string | null } | null>
}

const SNAPSHOTS_DIR = '.claude/observability/snapshots'
const SNAPSHOT_EXTENSION = '.json'

type SnapshotFs = {
  home: () => Promise<string | undefined>
  list: (dir: string) => Promise<Array<{ name: string; kind: string; mtimeMs: number }>>
  read: (path: string) => Promise<string>
}

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
          const snapshot = JSON.parse(await fs.read(`${dir}/${entry.name}`)) as AgentSnapshot
          return { name: entry.name, mtimeMs: entry.mtimeMs, snapshot }
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

/** `classicPermissionHooks` is a parameter so tests can exercise both flag states. */
export const registerHooks = (on: On, options: PluginOptions, classicPermissionHooks: boolean): void => {
  const profile = options.harnessProfile === true
  const retentionDays = typeof options.retentionDays === 'string' ? options.retentionDays : undefined
  const capture = createCapture<Host>({ profile, retentionDays, runtime: runtimeFrom })

  on('session.start', ($, e, next) =>
    capture.sessionStart(
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
    ),
  )
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
  on('agent.spawn', ($, e, next) =>
    capture.agentSpawn(
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
  on('agent.report', ($, e, next) =>
    capture.agentReport(
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
  on('session.measure', ($, e, next) =>
    capture.sessionMeasure(
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
  on('tool.check', ($, e, next) =>
    capture.toolCheck(
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
