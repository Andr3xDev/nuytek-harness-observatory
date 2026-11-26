import type { Figure, LiveAgent, ProfileFigures, TokenCounts, ToolFigures, TypeFigures } from '../../core/figures'
import { SCHEMA_VERSION, type AgentSnapshot, type ObsEvent } from '../../core/schema'

export type RecentAgent = Pick<Figure, keyof TokenCounts | 'tokens' | 'costUsd' | 'hasUnknownPrice'> & {
  type: string
  model: string | null
  effort: string | number | null
  startedAt: number
}

/** The reader accepts every record up to the schema this build writes. */
export const SUPPORTED_SCHEMA = SCHEMA_VERSION

export type SessionInput = {
  events: ObsEvent[]
  snapshots: AgentSnapshot[]
  pendingEvents?: readonly ObsEvent[]
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
