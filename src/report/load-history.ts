import { isSnapshotShape, tryParseJson } from '../core/guards'
import type { LiveAgent, SessionFigures, SourceListing } from '../core/figures'
import type { AgentSnapshot, ObsEvent } from '../core/schema'
import type { HistoryFs } from '../store/read/history-fs'
import { listSources, readLines } from '../store/read/reader'
import { agentSnapshotPathOf, eventsPathOf, mainSnapshotPathOf, sessionIdOfEventsPath } from '../store/layout'
import { parseJsonl } from './analysis/parse'
import { summarizeSession } from './analysis/session'
import type { SessionInput } from './analysis/types'

export const READ_CONCURRENCY = 8

export type EventsCache = Map<string, { size: number; mtimeMs: number; events: ObsEvent[] }>
export type HistoryDeps = {
  fs: HistoryFs
  /** Events parsed per session id, valid while the file's size and mtime are unchanged. Used only when `sessionIds` is set. */
  eventsCache?: EventsCache
}
export type LoadHistoryOptions = {
  sessionIds?: readonly string[]
  /** Skips sessions whose events file was last modified before this time, without opening them. */
  modifiedSince?: number
  pendingEvents?: Readonly<Record<string, readonly ObsEvent[]>>
  liveAgents?: Readonly<Record<string, readonly LiveAgent[]>>
  /** Sees the exact input a session was summarized from; the live panel keeps it to extend in memory. */
  onSessionInput?: (sessionId: string, input: SessionInput) => void
}

async function mapWithLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await task(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** A snapshot that cannot be read is dropped; the session keeps its other figures. */
const readSnapshot = async (fs: HistoryFs, path: string, listing: SourceListing): Promise<AgentSnapshot | null> => {
  if (!Object.hasOwn(listing, path)) return null
  const snapshot = await fs.readText(path).then(tryParseJson, () => undefined)
  return isSnapshotShape(snapshot) ? snapshot : null
}

const sessionIdsOf = (listing: SourceListing, requested: readonly string[] | undefined, modifiedSince: number | undefined): string[] => {
  const listed = Object.keys(listing).filter((path) => modifiedSince === undefined || (listing[path]?.mtimeMs ?? 0) >= modifiedSince)
  const ids = requested ?? listed.flatMap((path) => sessionIdOfEventsPath(path) ?? [])
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export async function loadHistory({ fs, eventsCache }: HistoryDeps, options: LoadHistoryOptions): Promise<SessionFigures[]> {
  const { pendingEvents = {}, liveAgents = {} } = options
  const listing = await listSources(fs)
  // Only the live session is re-read on every refresh; other sessions (after /clear or resume) must not stay cached.
  const cache = options.sessionIds ? eventsCache : undefined
  if (eventsCache && options.sessionIds) {
    for (const cachedId of eventsCache.keys()) if (!options.sessionIds.includes(cachedId)) eventsCache.delete(cachedId)
  }

  const loadSession = async (sessionId: string): Promise<SessionFigures | null> => {
    try {
      return await loadSessionOrThrow(sessionId)
    } catch {
      // A parseable but malformed record must not take the whole history down.
      return null
    }
  }

  const loadSessionOrThrow = async (sessionId: string): Promise<SessionFigures | null> => {
    const pending = Object.hasOwn(pendingEvents, sessionId) ? pendingEvents[sessionId] : undefined
    const live = Object.hasOwn(liveAgents, sessionId) ? liveAgents[sessionId] : undefined
    const isLive = (pending?.length ?? 0) > 0 || (live?.length ?? 0) > 0
    const eventsPath = eventsPathOf(sessionId)
    const stat = Object.hasOwn(listing, eventsPath) ? listing[eventsPath] : undefined

    if (!isLive && !stat) return null

    let events: ObsEvent[] = []
    if (stat) {
      // Hits only when the file is unchanged (closed sessions); a live session re-reads on each refresh.
      const hit = cache?.get(sessionId)
      if (hit && hit.size === stat.size && hit.mtimeMs === stat.mtimeMs) {
        events = [...hit.events]
      } else {
        const read = await readLines(fs, eventsPath, stat.size)
        if (!read.ok) return null
        events = parseJsonl(read.lines)
        cache?.set(sessionId, { size: stat.size, mtimeMs: stat.mtimeMs, events: [...events] })
      }
    }

    const agentIds = new Set([...events, ...(pending ?? [])].flatMap((event) => (event.type === 'agent.spawn' && event.agentId !== null ? [event.agentId] : [])))
    const paths = [mainSnapshotPathOf(sessionId), ...[...agentIds].map(agentSnapshotPathOf)]
    const snapshots = (await Promise.all(paths.map((path) => readSnapshot(fs, path, listing)))).flatMap((snapshot) => (snapshot ? [snapshot] : []))

    const input = { events, snapshots, pendingEvents: pending, liveAgents: live }
    options.onSessionInput?.(sessionId, input)
    return summarizeSession(input)
  }

  const loaded = await mapWithLimit(sessionIdsOf(listing, options.sessionIds, options.modifiedSince), READ_CONCURRENCY, loadSession)
  return loaded.flatMap((figures) => (figures ? [figures] : []))
}
