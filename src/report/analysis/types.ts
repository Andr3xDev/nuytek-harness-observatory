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
  SkillFigures,
  TokenCounts,
  ToolFigures,
  TypeFigures,
} from '../../core/figures'

export const SUPPORTED_SCHEMA = 1

export type SessionInput = {
  events: EventRecord[]
  snapshots: SnapshotRecord[]
  pendingEvents?: readonly EventRecord[]
  liveAgents?: readonly LiveAgent[]
}

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
