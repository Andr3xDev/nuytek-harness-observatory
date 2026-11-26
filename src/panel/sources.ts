import { HISTORY_WINDOW_MS } from '../core/constants'
import type { EventRecord, LiveAgent, SessionFigures } from '../core/figures'
import { mapUsage, type HostUsage } from '../core/usage'
import { combineSessions, mergeLiveEvents, summarizeSession, type SessionInput } from '../report/analysis'

// The aggregate is an opaque object at this seam (types/index.d.ts); tabs narrow it.
export type SessionLoad = {
  sessionFigures: SessionFigures
  aggregate: object
  liveAgentIds: string[]
  /** The agent the session itself runs as (`--agent`); null when it runs as none. */
  mainAgent?: string | null
}
export type HistoryLoad = { aggregate: object }
/** Figures re-derived in memory from events that arrived after the last store read. */
export type LiveOverlay = { sessionFigures: SessionFigures; aggregate: object }

export type Loaded<T> = ({ status: 'ready' } & T) | { status: 'unavailable'; reason: string }

export type SessionLoader = (sessionId: string) => Promise<SessionLoad>
export type HistoryLoader = () => Promise<HistoryLoad>
/** Synchronous and store-free; `null` when no store read has seeded this session yet. */
export type LiveSessionLoader = (sessionId: string) => LiveOverlay | null

export type Sources = {
  loadSessionAggregate: (sessionId: string) => Promise<Loaded<SessionLoad>>
  loadHistoryAggregate: () => Promise<Loaded<HistoryLoad>>
  liveSession: LiveSessionLoader
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

// Catches sync throws and rejections alike: a failed read must never reach render.
async function guarded<T>(load: () => Promise<T>): Promise<Loaded<T>> {
  try {
    return { status: 'ready', ...(await load()) }
  } catch (error) {
    return { status: 'unavailable', reason: reasonOf(error) }
  }
}

export function createSources(loaders: { loadSession: SessionLoader; loadHistory: HistoryLoader; liveSession: LiveSessionLoader }): Sources {
  return {
    loadSessionAggregate: (sessionId) => guarded(async () => loaders.loadSession(sessionId)),
    loadHistoryAggregate: () => guarded(async () => loaders.loadHistory()),
    liveSession: loaders.liveSession,
  }
}

/** One `$.agent.list()` row, as the host returns it (snake_case usage). */
export type LiveAgentRow = { id: string; usage?: HostUsage[]; cost?: { usd: number } }

export type LoadSessionsOptions = {
  sessionIds?: string[]
  modifiedSince?: number
  pendingEvents?: Record<string, readonly EventRecord[]>
  liveAgents?: Record<string, readonly LiveAgent[]>
  onSessionInput?: (sessionId: string, input: SessionInput) => void
}

export type LiveLoaderDeps = {
  now: () => number
  /** `loadHistory` of the store, bound to the file system only by the caller. */
  loadSessions: (options: LoadSessionsOptions) => Promise<SessionFigures[]>
  pendingEvents: (sessionId: string) => readonly EventRecord[]
  listAgents: () => Promise<readonly LiveAgentRow[]>
  readMainAgent: () => Promise<string | null>
}

export const liveAgentsOf = (rows: readonly LiveAgentRow[]): LiveAgent[] =>
  rows.map((row) => ({ agentId: row.id, usage: (row.usage ?? []).map(mapUsage), costUsd: row.cost?.usd ?? null }))

/** The real loaders: the session overlays unflushed events and running agents on the stored figures. */
export function createLiveLoaders(deps: LiveLoaderDeps): { loadSession: SessionLoader; loadHistory: HistoryLoader; liveSession: LiveSessionLoader } {
  // The current session's inputs, seeded by each store read; a different session id never matches it.
  let seed: { sessionId: string; input: SessionInput } | null = null
  return {
    liveSession: (sessionId) => {
      if (seed?.sessionId !== sessionId) return null
      // Accumulate: events flushed to disk since the seed leave the pending list but stay counted here.
      const events = mergeLiveEvents(seed.input.events, deps.pendingEvents(sessionId))
      seed = { sessionId, input: { ...seed.input, events } }
      const sessionFigures = summarizeSession(seed.input, { now: deps.now(), sourceMtimeMs: deps.now() })
      return { sessionFigures, aggregate: combineSessions([sessionFigures]) }
    },
    loadSession: async (sessionId) => {
      // A failed list keeps the stored figures: the overlay is optional.
      const rows = await deps.listAgents().catch((): readonly LiveAgentRow[] => [])
      seed = null
      const [figures] = await deps.loadSessions({
        sessionIds: [sessionId],
        pendingEvents: { [sessionId]: deps.pendingEvents(sessionId) },
        liveAgents: { [sessionId]: liveAgentsOf(rows) },
        onSessionInput: (id, input) => {
          seed = { sessionId: id, input: { ...input, events: mergeLiveEvents(input.events, input.pendingEvents ?? []), pendingEvents: undefined } }
        },
      })
      if (!figures) throw new Error('no data for this session yet')
      return {
        sessionFigures: figures,
        aggregate: combineSessions([figures]),
        liveAgentIds: rows.map((row) => row.id),
        mainAgent: await deps.readMainAgent().catch(() => null),
      }
    },
    loadHistory: async () => ({ aggregate: combineSessions(await deps.loadSessions({ modifiedSince: deps.now() - HISTORY_WINDOW_MS })) }),
  }
}
