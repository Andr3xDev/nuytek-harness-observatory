/**
 * The one place that knows how the store is laid out under `$HOME/.claude/observability`.
 * Writers, readers and the path validators all derive from it so they cannot drift apart.
 */

/** Session ids are UUIDs in practice; alphanumerics and `-` only. */
export const SESSION_ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9-]{0,63}'
/** Agent file stems allow `_` as well. */
export const FILE_STEM_SOURCE = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'

export const EVENTS_DIR = 'events'
export const SNAPSHOTS_DIR = 'snapshots'
export const EVENTS_EXTENSION = '.jsonl'
export const SNAPSHOT_EXTENSION = '.json'

export const eventsFileOf = (sessionId: string): string => `${sessionId}${EVENTS_EXTENSION}`
export const mainSnapshotFileOf = (sessionId: string): string => `main-${sessionId}${SNAPSHOT_EXTENSION}`
export const agentSnapshotFileOf = (agentId: string): string => `${agentId}${SNAPSHOT_EXTENSION}`

export const eventsPathOf = (sessionId: string): string => `${EVENTS_DIR}/${eventsFileOf(sessionId)}`
const EVENTS_LISTING_PATH = new RegExp(`^${EVENTS_DIR}/(.+)\\${EVENTS_EXTENSION}$`)
/** Lenient on purpose: reading must still list sessions whose id the writer rejects. */
export const sessionIdOfEventsPath = (path: string): string | undefined => EVENTS_LISTING_PATH.exec(path)?.[1]
export const snapshotPathOf = (file: string): string => `${SNAPSHOTS_DIR}/${file}`
export const mainSnapshotPathOf = (sessionId: string): string => snapshotPathOf(mainSnapshotFileOf(sessionId))
export const agentSnapshotPathOf = (agentId: string): string => snapshotPathOf(agentSnapshotFileOf(agentId))