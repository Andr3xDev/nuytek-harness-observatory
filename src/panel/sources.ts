import { combineSessions, type EventRecord, type LiveAgent, type SessionFigures } from '../report/analysis'
import { mapUsage, type HostUsage } from '../capture/events/records'

export type ContextReading = { percent: number | null; window: number }

// The aggregate is an opaque object at this seam (types/index.d.ts); tabs narrow it.
export type SessionLoad = {
  sessionFigures: SessionFigures
  aggregate: object
  liveAgentIds: string[]
  context?: ContextReading | null
}
export type HistoryLoad = { aggregate: object }

export type Loaded<T> = ({ status: 'ready' } & T) | { status: 'unavailable'; reason: string }

export type SessionLoader = (sessionId: string) => Promise<SessionLoad>
export type HistoryLoader = () => Promise<HistoryLoad>

export type Sources = {
  loadSessionAggregate: (sessionId: string) => Promise<Loaded<SessionLoad>>
  loadHistoryAggregate: () => Promise<Loaded<HistoryLoad>>
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

export function createSources(loaders: { loadSession: SessionLoader; loadHistory: HistoryLoader }): Sources {
  return {
    loadSessionAggregate: sessionId => guarded(async () => loaders.loadSession(sessionId)),
    loadHistoryAggregate: () => guarded(async () => loaders.loadHistory()),
  }
}

/** One `$.agent.list()` row, as the host returns it (snake_case usage). */
export type LiveAgentRow = { id: string; usage?: HostUsage[]; cost?: { usd: number } }

export type LoadSessionsOptions = {
  sessionIds?: string[]
  pendingEvents?: Record<string, readonly EventRecord[]>
  liveAgents?: Record<string, readonly LiveAgent[]>
}

export type LiveLoaderDeps = {
  /** `loadHistory` of the store, bound to the file system and writer by the caller. */
  loadSessions: (options: LoadSessionsOptions) => Promise<SessionFigures[]>
  pendingEvents: (sessionId: string) => readonly EventRecord[]
  listAgents: () => Promise<readonly LiveAgentRow[]>
  readContext: () => Promise<ContextReading | null>
}

export const liveAgentsOf = (rows: readonly LiveAgentRow[]): LiveAgent[] =>
  rows.map(row => ({ agentId: row.id, usage: (row.usage ?? []).map(mapUsage), costUsd: row.cost?.usd ?? null }))

/** The real loaders: the session overlays unflushed events and running agents on the stored figures. */
export function createLiveLoaders(deps: LiveLoaderDeps): { loadSession: SessionLoader; loadHistory: HistoryLoader } {
  return {
    loadSession: async sessionId => {
      // A failed list keeps the stored figures: the overlay is optional.
      const rows = await deps.listAgents().catch((): readonly LiveAgentRow[] => [])
      const [figures] = await deps.loadSessions({
        sessionIds: [sessionId],
        pendingEvents: { [sessionId]: deps.pendingEvents(sessionId) },
        liveAgents: { [sessionId]: liveAgentsOf(rows) },
      })
      if (!figures) throw new Error('no data for this session yet')
      return {
        sessionFigures: figures,
        aggregate: combineSessions([figures]),
        liveAgentIds: rows.map(row => row.id),
        context: await deps.readContext().catch(() => null),
      }
    },
    loadHistory: async () => ({ aggregate: combineSessions(await deps.loadSessions({})) }),
  }
}

// Fallback when the loaders cannot be built.
export const UNAVAILABLE_SOURCES: Sources = createSources({
  loadSession: async () => {
    throw new Error('report aggregates not available')
  },
  loadHistory: async () => {
    throw new Error('report aggregates not available')
  },
})
