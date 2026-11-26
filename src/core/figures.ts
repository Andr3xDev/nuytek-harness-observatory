import type { AgentSnapshot, ObsEvent, UsageRecord } from './schema'

export type EventRecord = ObsEvent
export type SnapshotRecord = AgentSnapshot

export type TokenCounts = { input: number; output: number; cacheRead: number; cacheCreation: number }
export type Money = { costUsd: number; hasUnknownPrice: boolean }
export type Figure = TokenCounts & Money & { tokens: number }

/** Normalized `$.agent.list()` row: the caller maps the host's snake_case usage and `cost.usd`. */
export type LiveAgent = { agentId: string; usage: UsageRecord[]; costUsd: number | null }
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

export type SkillCounts = { prompted: number; read: number; invoked: number }
export type SkillFigures = SkillCounts & { byAgentType: Record<string, SkillCounts> }
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

export type SourceStat = { size: number; mtimeMs: number }
/** Current files by store-relative path (`events/<id>.jsonl`, `snapshots/<id>.json`). */
export type SourceListing = Readonly<Record<string, SourceStat>>
