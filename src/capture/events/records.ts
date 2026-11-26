import { mapUsage, type HostUsage } from '../../core/usage'
import { parseMcpServer } from './parsers/mcp'
import { parseSkillsBlock } from './parsers/skills'
import {
  SCHEMA_VERSION,
  type AgentReportEvent,
  type AgentSpawnEvent,
  type CommandRunEvent,
  type Envelope,
  type ReconciliationEvent,
  type SessionCompactEvent,
  type SessionEndEvent,
  type SessionMeasureEvent,
  type SessionStartEvent,
  type SkillUseEvent,
  type SkillUseKind,
  type ToolVerdictEvent,
  type TurnCompleteEvent,
  type UsageRecord,
} from '../../core/schema'

export type EnvelopeContext = { sessionId: string; branch: string | null; now: number }

export const createEnvelope = <T extends string>(
  type: T,
  ctx: EnvelopeContext,
  agentId: string | null,
): Envelope<T> => ({
  schema: SCHEMA_VERSION,
  id: crypto.randomUUID(),
  type,
  ts: ctx.now,
  sessionId: ctx.sessionId,
  agentId,
  branch: ctx.branch,
})

export type SpawnInput = { prompt: string; subagentType: string; parentAgentId?: string }

export const buildSpawnRecord = (
  input: SpawnInput,
  result: { agentId: string },
  profile: boolean,
  ctx: EnvelopeContext,
): AgentSpawnEvent => ({
  ...createEnvelope('agent.spawn', ctx, result.agentId),
  parentAgentId: input.parentAgentId ?? null,
  subagentType: input.subagentType,
  skillsInjected: profile ? parseSkillsBlock(input.prompt) : null,
})

export type ReportInput = {
  agentId: string
  parentAgentId?: string
  subagentType: string
  status: 'completed' | 'failed' | 'stopped'
}

export const buildReportRecord = (input: ReportInput, ctx: EnvelopeContext): AgentReportEvent => ({
  ...createEnvelope('agent.report', ctx, input.agentId),
  parentAgentId: input.parentAgentId ?? null,
  subagentType: input.subagentType,
  engineStatus: input.status,
})

export type VerdictInput = { tool: string; tool_use_id: string; agentId?: string }

export const buildVerdictRecord = (input: VerdictInput, ctx: EnvelopeContext): ToolVerdictEvent => {
  const mcpServer = parseMcpServer(input.tool)
  const event: ToolVerdictEvent = {
    ...createEnvelope('tool.verdict', ctx, input.agentId ?? null),
    toolName: input.tool,
    toolUseId: input.tool_use_id,
  }
  if (mcpServer !== null) event.mcpServer = mcpServer
  return event
}

export type TurnInput = { agentId?: string; durationMs: number; usage?: HostUsage }
export type TurnExtras = { costUsd: number | null; previousModel: string }

const EMPTY_USAGE: Omit<UsageRecord, 'model'> = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }

export const buildTurnComplete = (input: TurnInput, ctx: EnvelopeContext, extras: TurnExtras): TurnCompleteEvent => {
  const event: TurnCompleteEvent = {
    ...createEnvelope('turn.complete', ctx, input.agentId ?? null),
    durationMs: input.durationMs,
    usage: input.usage ? mapUsage(input.usage) : { ...EMPTY_USAGE, model: extras.previousModel },
  }
  if (input.agentId === undefined) event.costUsd = extras.costUsd
  return event
}

export const buildSessionStart = (
  input: { cwd: string; isInteractive?: boolean },
  profile: boolean,
  ctx: EnvelopeContext,
): SessionStartEvent => {
  const event: SessionStartEvent = { ...createEnvelope('session.start', ctx, null), cwd: input.cwd, harnessProfile: profile }
  if (input.isInteractive !== undefined) event.isInteractive = input.isInteractive
  return event
}

export const buildSessionEnd = (state: { reason?: string }, ctx: EnvelopeContext): SessionEndEvent => {
  const event: SessionEndEvent = createEnvelope('session.end', ctx, null)
  if (state.reason !== undefined) event.reason = state.reason
  return event
}

export const buildSessionCompact = (ctx: EnvelopeContext): SessionCompactEvent =>
  createEnvelope('session.compact', ctx, null)

export const buildSkillUse = (
  input: { skill: string; kind: SkillUseKind; agentId: string | null },
  ctx: EnvelopeContext,
): SkillUseEvent => ({ ...createEnvelope('skill.use', ctx, input.agentId), skill: input.skill, kind: input.kind })

export const buildCommandRun = (input: { name: string }, ctx: EnvelopeContext): CommandRunEvent => ({
  ...createEnvelope('command.run', ctx, null),
  name: input.name,
})

export const buildSessionMeasure = (
  input: { costUsd: number; hasUnknownPrice: boolean; context?: object; rateLimits?: object },
  ctx: EnvelopeContext,
): SessionMeasureEvent => ({
  ...createEnvelope('session.measure', ctx, null),
  costUsd: input.costUsd,
  hasUnknownPrice: input.hasUnknownPrice,
  context: input.context ?? null,
  rateLimits: input.rateLimits ?? null,
})

export const buildReconciliationRecord = (
  result: Omit<ReconciliationEvent, keyof Envelope<'reconciliation'>>,
  ctx: EnvelopeContext,
): ReconciliationEvent => ({ ...createEnvelope('reconciliation', ctx, null), ...result })
