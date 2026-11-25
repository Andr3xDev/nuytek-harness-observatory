import type { SessionFigures } from '../aggregates'

// The aggregate is an opaque object at this seam (types/index.d.ts); tabs narrow it.
export type SessionLoad = {
  sessionFigures: SessionFigures
  aggregate: object
  liveAgentIds: string[]
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

// Used until the report change lands (task 3.2 swaps in the real loaders).
export const UNAVAILABLE_SOURCES: Sources = createSources({
  loadSession: async () => {
    throw new Error('report aggregates not available')
  },
  loadHistory: async () => {
    throw new Error('report aggregates not available')
  },
})
