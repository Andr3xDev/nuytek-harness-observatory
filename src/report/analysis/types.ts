import type {
  EventRecord,
  Figure,
  LiveAgent,
  ProfileFigures,
  SessionFigures,
  SessionState,
  SnapshotRecord,
  SourceStat,
  TokenCounts,
  ToolFigures,
  TypeFigures,
} from '../../core/figures'

export type {
  AgentFigures,
  EventRecord,
  Figure,
  LiveAgent,
  Money,
  ProfileFigures,
  SessionFigures,
  SessionState,
  SkillCounts,
  SkillFigures,
  SnapshotRecord,
  SourceListing,
  SourceStat,
  TokenCounts,
  ToolFigures,
  TreeFigures,
  TypeFigures,
} from '../../core/figures'

export const OPEN_SESSION_MAX_IDLE_MS = 6 * 60 * 60 * 1000
export const CACHE_RATIO_MIN_PROMPT_TOKENS = 20000
export const ROLLUP_MAX_BASH_COMMANDS = 50
export const MAX_COMMAND_CHARS = 200
export const SUPPORTED_SCHEMA = 1

export type SessionInput = {
  events: EventRecord[]
  snapshots: SnapshotRecord[]
  pendingEvents?: readonly EventRecord[]
  liveAgents?: readonly LiveAgent[]
}
export type SessionContext = { now: number; sourceMtimeMs: number }

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

export type SessionRollup = {
  rollupVersion: number
  schemaVersions: number[]
  sessionId: string
  state: SessionState
  sources: Array<{ path: string } & SourceStat>
  builtAt: number
  figures: SessionFigures
}
