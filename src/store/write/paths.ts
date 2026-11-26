import { FILE_STEM_SOURCE, PROMPTS_DAY_SOURCE, SESSION_ID_SOURCE } from '../layout'

const EVENTS_PATH = new RegExp(`^events/${SESSION_ID_SOURCE}\\.jsonl$`)
const PROMPTS_PATH = new RegExp(`^prompts-${PROMPTS_DAY_SOURCE}\\.jsonl$`)
const SNAPSHOTS_PATH = new RegExp(`^snapshots/${FILE_STEM_SOURCE}\\.json$`)
const ROLLUP_PATH = new RegExp(`^rollup/${FILE_STEM_SOURCE}\\.json$`)
const EVENTS_FILE_NAME = new RegExp(`^${SESSION_ID_SOURCE}\\.jsonl$`)
const SNAPSHOT_FILE_NAME = new RegExp(`^${FILE_STEM_SOURCE}\\.json$`)
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
