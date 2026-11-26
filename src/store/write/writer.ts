import { isValidAppendPath, isValidMaintainArgs, isValidUpsertPath } from './paths'
import { appendArgv, initArgv, maintainArgv, upsertArgv } from './scripts'

export const WRITE_TIMEOUT_MS = 5_000
export const MAINTAIN_TIMEOUT_MS = 15_000

export type RunCall = { argv: string[]; stdin?: string; timeoutMs: number }
export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type ProcessRunner = (argv: string[], options: Omit<RunCall, 'argv'>) => Promise<RunResult>

export type Writer = {
  /** Creates the store root so the fail-closed `cd` of the other scripts succeeds on a first run. */
  init: () => Promise<boolean>
  append: (path: string, text: string) => Promise<boolean>
  upsert: (path: string, text: string) => Promise<boolean>
  maintain: (days: string, eventsFile: string, snapshotFile: string) => Promise<boolean>
}

export const createWriter = (run: ProcessRunner): Writer => {
  // Capture never throws on a write failure: a failed or throwing run is just `false`.
  const execute = async (argv: string[], options: Omit<RunCall, 'argv'>): Promise<boolean> => {
    try {
      return (await run(argv, options)).exitCode === 0
    } catch {
      return false
    }
  }

  return {
    init: () => execute(initArgv(), { timeoutMs: WRITE_TIMEOUT_MS }),
    append: async (path, text) =>
      isValidAppendPath(path) ? execute(appendArgv(path), { stdin: text, timeoutMs: WRITE_TIMEOUT_MS }) : false,
    upsert: async (path, text) =>
      isValidUpsertPath(path) ? execute(upsertArgv(path), { stdin: text, timeoutMs: WRITE_TIMEOUT_MS }) : false,
    maintain: async (days, eventsFile, snapshotFile) =>
      isValidMaintainArgs(days, eventsFile, snapshotFile)
        ? execute(maintainArgv(days, eventsFile, snapshotFile), { timeoutMs: MAINTAIN_TIMEOUT_MS })
        : false,
  }
}
