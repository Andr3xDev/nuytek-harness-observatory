/**
 * The one place that knows how the store is laid out under `$HOME/.claude/observability`.
 * Writers, readers and the path validators all derive from it so they cannot drift apart.
 */

/** Session ids are UUIDs in practice; this is the stricter of the rules the store used to carry. */
export const SESSION_ID_SOURCE = '[A-Za-z0-9][A-Za-z0-9-]{0,63}'
/** Agent and rollup file stems allow `_` as well. */
export const FILE_STEM_SOURCE = '[A-Za-z0-9][A-Za-z0-9_-]{0,95}'
export const SESSION_ID_PATTERN = new RegExp(`^${SESSION_ID_SOURCE}$`)
/** `YYYY-MM-DD`, the day slice of an ISO timestamp. */
export const PROMPTS_DAY_SOURCE = '\\d{4}-\\d{2}-\\d{2}'

export const eventsFileOf = (sessionId: string): string => `${sessionId}.jsonl`
export const mainSnapshotFileOf = (sessionId: string): string => `main-${sessionId}.json`
export const agentSnapshotFileOf = (agentId: string): string => `${agentId}.json`

export const eventsPathOf = (sessionId: string): string => `events/${eventsFileOf(sessionId)}`
const EVENTS_LISTING_PATH = /^events\/(.+)\.jsonl$/
/** Lenient on purpose: reading must still list sessions whose id the writer would now reject. */
export const sessionIdOfEventsPath = (path: string): string | undefined => EVENTS_LISTING_PATH.exec(path)?.[1]
export const snapshotPathOf = (file: string): string => `snapshots/${file}`
export const mainSnapshotPathOf = (sessionId: string): string => snapshotPathOf(mainSnapshotFileOf(sessionId))
export const agentSnapshotPathOf = (agentId: string): string => snapshotPathOf(agentSnapshotFileOf(agentId))
export const rollupPathOf = (sessionId: string): string => `rollup/${sessionId}.json`
export const promptsPathOf = (day: string): string => `prompts-${day}.jsonl`
