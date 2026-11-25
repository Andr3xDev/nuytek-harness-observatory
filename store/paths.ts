const EVENTS_PATH = /^events\/[A-Za-z0-9][A-Za-z0-9-]{0,63}\.jsonl$/
const PROMPTS_PATH = /^prompts-\d{4}-\d{2}-\d{2}\.jsonl$/
const SNAPSHOTS_PATH = /^snapshots\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/
const ROLLUP_PATH = /^rollup\/[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/
const EVENTS_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}\.jsonl$/
const SNAPSHOT_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/
const DAYS = /^\d{1,4}$/

export type PathCheck = { ok: true; path: string } | { ok: false }
export type MaintainCheck = { ok: true; args: [days: string, eventsFile: string, snapshotFile: string] } | { ok: false }

const checkPath = (path: string, allowed: readonly RegExp[]): PathCheck =>
  allowed.some((pattern) => pattern.test(path)) ? { ok: true, path } : { ok: false }

export const validateAppendPath = (path: string): PathCheck => checkPath(path, [EVENTS_PATH, PROMPTS_PATH])

export const validateUpsertPath = (path: string): PathCheck => checkPath(path, [SNAPSHOTS_PATH, ROLLUP_PATH])

export const validateMaintainArgs = (days: string, eventsFile: string, snapshotFile: string): MaintainCheck =>
  DAYS.test(days) && EVENTS_FILE_NAME.test(eventsFile) && SNAPSHOT_FILE_NAME.test(snapshotFile)
    ? { ok: true, args: [days, eventsFile, snapshotFile] }
    : { ok: false }
