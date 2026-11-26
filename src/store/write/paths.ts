import { FILE_STEM_SOURCE, PROMPTS_DAY_SOURCE, SESSION_ID_SOURCE } from '../layout'

const EVENTS_PATH = new RegExp(`^events/${SESSION_ID_SOURCE}\\.jsonl$`)
const PROMPTS_PATH = new RegExp(`^prompts-${PROMPTS_DAY_SOURCE}\\.jsonl$`)
const SNAPSHOTS_PATH = new RegExp(`^snapshots/${FILE_STEM_SOURCE}\\.json$`)
const EVENTS_FILE_NAME = new RegExp(`^${SESSION_ID_SOURCE}\\.jsonl$`)
const SNAPSHOT_FILE_NAME = new RegExp(`^${FILE_STEM_SOURCE}\\.json$`)
const DAYS = /^\d{1,4}$/

const matchesAny = (path: string, allowed: readonly RegExp[]): boolean => allowed.some((pattern) => pattern.test(path))

export const isValidAppendPath = (path: string): boolean => matchesAny(path, [EVENTS_PATH, PROMPTS_PATH])

export const isValidUpsertPath = (path: string): boolean => matchesAny(path, [SNAPSHOTS_PATH])

export const isValidMaintainArgs = (days: string, eventsFile: string, snapshotFile: string): boolean =>
  DAYS.test(days) && EVENTS_FILE_NAME.test(eventsFile) && SNAPSHOT_FILE_NAME.test(snapshotFile)
