import type { UsageRecord } from './schema'

export type TokenCounts = { input: number; output: number; cacheRead: number; cacheCreation: number }
type Money = { costUsd: number; hasUnknownPrice: boolean }
export type Figure = TokenCounts & Money & { tokens: number }

/** A fresh zeroed figure each call: callers accumulate into it. */
export const emptyFigure = (): Figure => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, tokens: 0, costUsd: 0, hasUnknownPrice: false })

export const zeroTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })

export const totalTokens = (counts: TokenCounts): number => counts.input + counts.output + counts.cacheRead + counts.cacheCreation

export const addTokens = (target: TokenCounts, part: TokenCounts): void => {
  target.input += part.input
  target.output += part.output
  target.cacheRead += part.cacheRead
  target.cacheCreation += part.cacheCreation
}

export const addFigure = (target: Figure, part: Figure): void => {
  addTokens(target, part)
  target.tokens += part.tokens
  target.costUsd += part.costUsd
  target.hasUnknownPrice ||= part.hasUnknownPrice
}

/** Records keyed by event text must not inherit `constructor`, `__proto__` and friends. */
export const createRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

export const getOrInit = <T>(record: Record<string, T>, key: string, make: () => T): T => (record[key] ??= make())

/** Normalized `$.agent.list()` row: the caller maps the host's snake_case usage and `cost.usd`. */
export type LiveAgent = { agentId: string; usage: UsageRecord[]; costUsd: number | null; hasUnknownPrice: boolean }

export type TypeFigures = Figure & { spawns: number }
export type AgentFigures = Figure & {
  agentId: string
  parentAgentId: string | null
  subagentType: string
  /** `null` when no usage or snapshot named one. */
  model: string | null
  /** The effort set for the agent (level or budget); `null` when it took the session's. */
  effort: string | number | null
  startedAt: number
  engineStatus: 'running' | 'completed' | 'failed' | 'stopped' | 'unknown'
}

export type SkillCounts = { prompted: number; read: number; invoked: number }
export type SkillFigures = SkillCounts & { byAgentType: Record<string, SkillCounts> }
export type ToolFigures = {
  skills: Record<string, SkillFigures>
  mcp: Record<string, Record<string, number>>
  commands: Record<string, number>
}

export type ProfileFigures = {
  skillsInjected: Record<string, number>
}

export type SessionFigures = {
  sessionId: string
  harnessProfile: boolean
  startedAt: number | null
  lastEventAt: number | null
  total: Figure
  main: Figure
  /** Model of the latest main-loop usage record. */
  mainModel: string | null
  byType: Record<string, TypeFigures>
  byModel: Record<string, TokenCounts & { tokens: number }>
  agents: AgentFigures[]
  tools: ToolFigures
  profile: ProfileFigures | null
}

type SourceStat = { size: number; mtimeMs: number }
/** Current files by store-relative path (`events/<id>.jsonl`, `snapshots/<id>.json`). */
export type SourceListing = Readonly<Record<string, SourceStat>>
