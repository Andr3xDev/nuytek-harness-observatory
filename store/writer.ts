import { validateAppendPath, validateMaintainArgs, validateUpsertPath } from './paths'
import { appendArgv, initArgv, maintainArgv, upsertArgv } from './scripts'

export const WRITE_TIMEOUT_MS = 5_000
export const MAINTAIN_TIMEOUT_MS = 15_000
export const MAX_WRITE_FAILURES = 50

export type RunCall = { argv: string[]; stdin?: string; timeoutMs: number }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type ProcessRunner = (argv: string[], options: Omit<RunCall, 'argv'>) => Promise<RunResult>

export type Writer = {
  /** Creates the store root so the fail-closed `cd` of the other scripts succeeds on a first run. */
  init: () => Promise<boolean>
  append: (path: string, text: string) => Promise<boolean>
  upsert: (path: string, text: string) => Promise<boolean>
  maintain: (days: string, eventsFile: string, snapshotFile: string) => Promise<boolean>
  /** In-memory log of failed runs; capture never throws on write failure. */
  failures: string[]
}

export const createWriter = (run: ProcessRunner): Writer => {
  const failures: string[] = []

  const recordFailure = (message: string): void => {
    failures.push(message)
    if (failures.length > MAX_WRITE_FAILURES) failures.splice(0, failures.length - MAX_WRITE_FAILURES)
  }

  const execute = async (argv: string[], options: Omit<RunCall, 'argv'>): Promise<boolean> => {
    try {
      const result = await run(argv, options)
      if (result.exitCode === 0) return true
      recordFailure(`exit ${result.exitCode}: ${result.stderr}`)
    } catch (error) {
      recordFailure(String(error))
    }
    return false
  }

  return {
    failures,
    init: () => execute(initArgv(), { timeoutMs: WRITE_TIMEOUT_MS }),
    append: async (path, text) =>
      validateAppendPath(path).ok ? execute(appendArgv(path), { stdin: text, timeoutMs: WRITE_TIMEOUT_MS }) : false,
    upsert: async (path, text) =>
      validateUpsertPath(path).ok ? execute(upsertArgv(path), { stdin: text, timeoutMs: WRITE_TIMEOUT_MS }) : false,
    maintain: async (days, eventsFile, snapshotFile) =>
      validateMaintainArgs(days, eventsFile, snapshotFile).ok
        ? execute(maintainArgv(days, eventsFile, snapshotFile), { timeoutMs: MAINTAIN_TIMEOUT_MS })
        : false,
  }
}
