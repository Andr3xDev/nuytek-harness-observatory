import type { AgentSnapshot, ObsEvent, UsageRecord } from '../capture/schema'

export const OPEN_SESSION_MAX_IDLE_MS = 6 * 60 * 60 * 1000
export const CACHE_RATIO_MIN_PROMPT_TOKENS = 20000
export const ROLLUP_MAX_BASH_COMMANDS = 50
export const MAX_COMMAND_CHARS = 200
export const SUPPORTED_SCHEMA = 1

export type EventRecord = ObsEvent
export type SnapshotRecord = AgentSnapshot

export type TokenCounts = { input: number; output: number; cacheRead: number; cacheCreation: number }
export type Money = { costUsd: number; hasUnknownPrice: boolean }
export type Figure = TokenCounts & Money & { tokens: number }

/** Normalized `$.agent.list()` row: the caller maps the host's snake_case usage and `cost.usd`. */
export type LiveAgent = { agentId: string; usage: UsageRecord[]; costUsd: number | null }
export type SessionInput = {
  events: EventRecord[]
  snapshots: SnapshotRecord[]
  pendingEvents?: readonly EventRecord[]
  liveAgents?: readonly LiveAgent[]
}
export type SessionContext = { now: number; sourceMtimeMs: number }
export type SessionState = 'open' | 'closed' | 'stale'

export type TypeFigures = Figure & { spawns: number; durationMs: number; engineStatusMix: Record<string, number> }
export type TreeFigures = Figure & { rootAgentId: string; subagentType: string; issue: string; promptTokens: number; agents: number }
export type AgentFigures = Figure & {
  agentId: string
  parentAgentId: string | null
  subagentType: string
  engineStatus: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'
  durationMs: number
}

export type SkillFigures = { read: number; invoked: number; byAgentType: Record<string, { read: number; invoked: number }> }
export type ToolFigures = {
  skills: Record<string, SkillFigures>
  mcp: Record<string, Record<string, number>>
  commands: Record<string, number>
  bash: Record<string, number>
  verdicts: Record<string, { allow: number; ask: number; deny: number }>
  denyReasons: Record<string, number>
  outcomes: Record<string, number>
  bashPromptHook: { calls: number; usd: number | null } | null
}

export type ProfileFigures = {
  statusMixByType: Record<string, Record<string, number>>
  reroutesByType: Record<string, number>
  reviewPasses: number
  skillsInjected: Record<string, number>
  guards: Record<string, number>
}

export type SessionFigures = {
  sessionId: string
  state: SessionState
  harnessProfile: boolean
  startedAt: number | null
  endedAt: number | null
  /** Absent in rollups stored before this field existed. */
  lastEventAt?: number | null
  total: Figure
  main: Figure
  byType: Record<string, TypeFigures>
  byModel: Record<string, TokenCounts & { tokens: number }>
  byIssue: Record<string, Figure>
  trees: TreeFigures[]
  agents: AgentFigures[]
  tools: ToolFigures
  denies: number
  profile: ProfileFigures | null
  coverage: { agentsWithoutSnapshot: number; mainCostGapUsd: number; skippedNewerSchema: number }
}

export type ParseResult = { records: EventRecord[]; skippedNewerSchema: number; skippedMalformed: number }

export type Coverage = { profileSessions: number; sessions: number }
export type AggregateFigures = {
  sessions: number
  openSessions: number
  windowStart: number | null
  windowEnd: number | null
  total: Figure
  cacheRatio: number | null
  byType: Array<
    TypeFigures & {
      type: string
      spawnShare: number | null
      tokenShare: number | null
      avgTokens: number | null
      avgDurationMs: number | null
      cacheRatio: number | null
    }
  >
  byModel: Array<{ model: string } & TokenCounts & { tokens: number }>
  byIssue: Array<{ issue: string } & Figure>
  engineStatusMix: Record<string, number>
  denies: number
  tools: ToolFigures
  profile: (ProfileFigures & { coverage: Coverage }) | null
}

export type Anomaly = {
  kind: 'delegation-cost' | 'cache-ratio' | 'denies'
  scope: 'tree' | 'session'
  sessionId: string
  rootAgentId?: string
  subagentType?: string
  issue?: string
  value: number
  threshold: number
}
export type Thresholds = { anomalyDelegationCostUsd: number; anomalyCacheRatioMin: number; anomalyDeniesPerSessionMax: number }

export type SourceStat = { size: number; mtimeMs: number }
/** Current files by store-relative path (`events/<id>.jsonl`, `snapshots/<id>.json`). */
export type SourceListing = Readonly<Record<string, SourceStat>>
export type SessionRollup = {
  rollupVersion: number
  schemaVersions: number[]
  sessionId: string
  state: SessionState
  sources: Array<{ path: string } & SourceStat>
  builtAt: number
  figures: SessionFigures
}
