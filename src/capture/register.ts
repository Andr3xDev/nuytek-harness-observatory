import type { On, PluginOptions } from 'claude-code'
import { createBatcher } from '../store/write/batcher'
import { createWriter, WRITE_TIMEOUT_MS, type ProcessRunner } from '../store/write/writer'
import { createCapture, type HostApi, type Runtime } from './handlers'
import { createBranchProvider } from './session/branch'

/**
 * Closures over `$`: the plugin validator rejects any use of `$` as a value, so every hook
 * builds this object inline from `$.noun.event(...)` calls.
 */
type Host = HostApi & {
  run: ProcessRunner
  every: (ms: number, fn: () => void) => { cancel: () => void }
  detect: (path: string) => Promise<{ branch: string | null } | null>
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

export const createPluginCapture = (options: PluginOptions) =>
  createCapture<Host>({
    profile: options.harnessProfile === true,
    retentionDays: typeof options.retentionDays === 'string' ? options.retentionDays : undefined,
    runtime: runtimeFrom,
  })

export type Capture = ReturnType<typeof createPluginCapture>

/**
 * Registers every capture event except `session.start`, which the panel module owns because it also
 * sets the panel up (an event can be registered once). `onObserved` lets the panel refresh after the
 * events it watches; it runs after capture records, so the new event is pending.
 */
export const registerCapture = (
  on: On,
  capture: Capture,
  classicPermissionHooks: boolean,
  onObserved: (type: string) => void,
): void => {
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
    onObserved('agent.spawn')
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
    onObserved('agent.report')
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
    onObserved('session.measure')
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
    onObserved('tool.check')
    return result
  })

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
