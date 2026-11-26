import type {
  EventRecord,
  Figure,
  LiveAgent,
  ProfileFigures,
  SnapshotRecord,
  TokenCounts,
  ToolFigures,
  TypeFigures,
} from '../../core/figures'

export type RecentAgent = Pick<Figure, keyof TokenCounts | 'tokens' | 'costUsd' | 'hasUnknownPrice'> & {
  sessionId: string
  agentId: string
  type: string
  model: string | null
  effort: string | number | null
  startedAt: number
}

export type {
  AgentFigures,
  EventRecord,
  Figure,
  LiveAgent,
  ProfileFigures,
  SessionFigures,
  SessionState,
  SkillFigures,
  SourceListing,
  SourceStat,
  TokenCounts,
  ToolFigures,
  TypeFigures,
} from '../../core/figures'

export const OPEN_SESSION_MAX_IDLE_MS = 6 * 60 * 60 * 1000
export const SUPPORTED_SCHEMA = 1

export type SessionInput = {
  events: EventRecord[]
  snapshots: SnapshotRecord[]
  pendingEvents?: readonly EventRecord[]
  liveAgents?: readonly LiveAgent[]
}
export type SessionContext = { now: number; sourceMtimeMs: number }

export type AggregateFigures = {
  sessions: number
  windowStart: number | null
  windowEnd: number | null
  total: Figure
  byType: Array<TypeFigures & { type: string }>
  /** One row per agent type, model and effort; `model` and `effort` are null when none was recorded. */
  byTypeModelEffort: Array<Figure & { type: string; model: string | null; effort: string | number | null; spawns: number }>
  /** The latest agent runs across the sessions, newest first, capped at `RECENT_AGENTS_CAP`. */
  recentAgents: RecentAgent[]
  byModel: Array<{ model: string } & TokenCounts & { tokens: number }>
  tools: ToolFigures
  profile: ProfileFigures | null
}
