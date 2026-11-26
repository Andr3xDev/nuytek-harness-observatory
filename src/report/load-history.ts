import type { EventRecord, LiveAgent, SessionFigures, SnapshotRecord, SourceListing } from '../core/figures'
import type { HistoryFs } from '../store/read/history-fs'
import { listSources, readLines } from '../store/read/reader'
import { SESSION_ID_PATTERN, agentSnapshotPathOf, eventsPathOf, mainSnapshotPathOf, rollupPathOf, sessionIdOfEventsPath } from '../store/layout'
import type { Writer } from '../store/write/writer'
import { parseJsonl } from './analysis/parse'
import { buildRollup, isRollupFresh } from './analysis/rollup'
import { summarizeSession } from './analysis/session'

export const READ_CONCURRENCY = 8

/** Without a `writer` the load is read-only: no rollup is built or stored. */
export type HistoryDeps = { fs: HistoryFs; writer?: Pick<Writer, 'upsert'> }
export type LoadHistoryOptions = {
  now: number
  sessionIds?: readonly string[]
  pendingEvents?: Readonly<Record<string, readonly EventRecord[]>>
  liveAgents?: Readonly<Record<string, readonly LiveAgent[]>>
}
export type HistoryResult = { sessions: SessionFigures[]; warnings: number; rollupWriteFailures: number }

type LoadedSession = { sessionId: string; figures: SessionFigures; cacheable: boolean }

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

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

const readRollup = async (fs: HistoryFs, sessionId: string, listing: SourceListing): Promise<SessionFigures | null> => {
  const rollup = await fs.readText(rollupPathOf(sessionId)).then(parseJson, () => undefined)
  return isRollupFresh(rollup, listing) && rollup.sessionId === sessionId ? rollup.figures : null
}

/** A snapshot that cannot be read is dropped; the session keeps its other figures. */
const readSnapshot = async (fs: HistoryFs, path: string, listing: SourceListing): Promise<SnapshotRecord | null> => {
  if (!Object.hasOwn(listing, path)) return null
  const snapshot = await fs.readText(path).then(parseJson, () => undefined)
  return typeof snapshot === 'object' && snapshot !== null ? (snapshot as SnapshotRecord) : null
}

const sessionIdsOf = (listing: SourceListing, requested: readonly string[] | undefined): string[] => {
  const ids = requested ?? Object.keys(listing).flatMap((path) => sessionIdOfEventsPath(path) ?? [])
  return [...new Set(ids)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
}

export async function loadHistory({ fs, writer }: HistoryDeps, options: LoadHistoryOptions): Promise<HistoryResult> {
  const { now, pendingEvents = {}, liveAgents = {} } = options
  const listing = await listSources(fs)
  let warnings = 0

  const loadSession = async (sessionId: string): Promise<LoadedSession | null> => {
    try {
      return await loadSessionOrThrow(sessionId)
    } catch {
      // A parseable but malformed record must not take the whole report down.
      warnings += 1
      return null
    }
  }

  const loadSessionOrThrow = async (sessionId: string): Promise<LoadedSession | null> => {
    const pending = Object.hasOwn(pendingEvents, sessionId) ? pendingEvents[sessionId] : undefined
    const live = Object.hasOwn(liveAgents, sessionId) ? liveAgents[sessionId] : undefined
    const isLive = (pending?.length ?? 0) > 0 || (live?.length ?? 0) > 0
    const eventsPath = eventsPathOf(sessionId)
    const stat = Object.hasOwn(listing, eventsPath) ? listing[eventsPath] : undefined

    if (!isLive && !stat) return null

    if (!isLive && stat) {
      const stored = await readRollup(fs, sessionId, listing)
      if (stored) return { sessionId, figures: stored, cacheable: false }
    }

    let events: EventRecord[] = []
    let skippedNewerSchema = 0
    if (stat) {
      const read = await readLines(fs, eventsPath, stat.size)
      if (!read.ok) {
        warnings += 1
        return null
      }
      const parsed = parseJsonl(read.lines)
      events = parsed.records
      skippedNewerSchema = parsed.skippedNewerSchema
    }

    const agentIds = new Set([...events, ...(pending ?? [])].flatMap((event) => (event.type === 'agent.spawn' && event.agentId !== null ? [event.agentId] : [])))
    const paths = [mainSnapshotPathOf(sessionId), ...[...agentIds].map(agentSnapshotPathOf)]
    const snapshots = (await Promise.all(paths.map((path) => readSnapshot(fs, path, listing)))).flatMap((snapshot) => (snapshot ? [snapshot] : []))

    const figures = summarizeSession({ events, snapshots, pendingEvents: pending, liveAgents: live }, { now, sourceMtimeMs: stat?.mtimeMs ?? now })
    return {
      sessionId,
      figures: { ...figures, coverage: { ...figures.coverage, skippedNewerSchema } },
      cacheable: !isLive && stat !== undefined && figures.state !== 'open' && SESSION_ID_PATTERN.test(sessionId),
    }
  }

  const loaded = await mapWithLimit(sessionIdsOf(listing, options.sessionIds), READ_CONCURRENCY, loadSession)
  const present = loaded.flatMap((entry) => (entry ? [entry] : []))

  const upsert = writer?.upsert.bind(writer)
  const writes = upsert
    ? await mapWithLimit(
        present.filter(({ cacheable }) => cacheable),
        READ_CONCURRENCY,
        ({ sessionId, figures }) => upsert(rollupPathOf(sessionId), JSON.stringify(buildRollup(figures, listing, now))).catch(() => false),
      )
    : []
  const rollupWriteFailures = writes.filter((written) => !written).length

  return { sessions: present.map((entry) => entry.figures), warnings, rollupWriteFailures }
}
