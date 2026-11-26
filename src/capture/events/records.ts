import { PARSER_VERSION, REPORT_EXCERPT_MAX_BYTES } from '../../core/constants'
import { mapUsage, type HostUsage } from '../../core/usage'
import { parseMcpServer } from './parsers/mcp'
import { parseGuardName } from './parsers/guard'
import { parseReportStatus } from './parsers/report'
import { parseSkillsBlock } from './parsers/skills'
import {
  SCHEMA_VERSION,
  type AgentReportEvent,
  type AgentSpawnEvent,
  type CommandRunEvent,
  type Envelope,
  type PermissionOutcome,
  type PermissionOutcomeEvent,
  type PromptRecord,
  type ReconciliationEvent,
  type SessionCompactEvent,
  type SessionEndEvent,
  type SessionEstimates,
  type SessionMeasureEvent,
  type SessionStartEvent,
  type SkillUseEvent,
  type SkillUseKind,
  type ToolDecision,
  type ToolVerdictEvent,
  type TurnCompleteEvent,
  type UsageRecord,
} from '../../core/schema'

export type EnvelopeContext = { sessionId: string; branch: string | null; now: number }

const BASH_TOOL = 'Bash'
const SPAWN_PROMPT_ID_PREFIX = 'pr-'
const HEX_RADIX = 16
const HEX_BYTE_WIDTH = 2

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

const encoder = new TextEncoder()

export const sha256Hex = async (text: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(HEX_RADIX).padStart(HEX_BYTE_WIDTH, '0')).join('')
}

const truncateToBytes = (text: string, maxBytes: number): string => {
  let bytes = 0
  let end = 0
  for (const codePoint of text) {
    bytes += encoder.encode(codePoint).length
    if (bytes > maxBytes) break
    end += codePoint.length
  }
  return text.slice(0, end)
}

export type SpawnInput = { prompt: string; subagentType: string; parentAgentId?: string }

export const buildSpawnRecord = async (
  input: SpawnInput,
  result: { agentId: string },
  profile: boolean,
  ctx: EnvelopeContext,
): Promise<{ event: AgentSpawnEvent; prompt: PromptRecord }> => {
  const promptId = SPAWN_PROMPT_ID_PREFIX + result.agentId
  const sha = await sha256Hex(input.prompt)
  const bytes = encoder.encode(input.prompt).length
  const event: AgentSpawnEvent = {
    ...createEnvelope('agent.spawn', ctx, result.agentId),
    parentAgentId: input.parentAgentId ?? null,
    subagentType: input.subagentType,
    promptId,
    promptBytes: bytes,
    promptSha: sha,
    skillsInjected: profile ? parseSkillsBlock(input.prompt) : null,
  }
  const prompt: PromptRecord = {
    schema: SCHEMA_VERSION,
    promptId,
    sessionId: ctx.sessionId,
    ts: ctx.now,
    agentId: result.agentId,
    subagentType: input.subagentType,
    sha,
    bytes,
    text: input.prompt,
  }
  return { event, prompt }
}

export type ReportInput = {
  agentId: string
  parentAgentId?: string
  subagentType: string
  status: 'completed' | 'failed' | 'stopped'
  text: string
}

export const buildReportRecord = (input: ReportInput, profile: boolean, ctx: EnvelopeContext): AgentReportEvent => ({
  ...createEnvelope('agent.report', ctx, input.agentId),
  parentAgentId: input.parentAgentId ?? null,
  subagentType: input.subagentType,
  reportExcerpt: truncateToBytes(input.text, REPORT_EXCERPT_MAX_BYTES),
  engineStatus: input.status ?? null,
  status: profile ? parseReportStatus(input.text) : null,
  parserVersion: profile ? PARSER_VERSION : null,
})

export type VerdictInput = { tool: string; input: { command?: unknown }; tool_use_id: string; agentId?: string }
export type VerdictResult = {
  decision: ToolDecision
  reason?: string
  rule?: string
  hook?: string
  plugin?: string
}

export const buildVerdictRecord = (
  input: VerdictInput,
  result: VerdictResult,
  profile: boolean,
  ctx: EnvelopeContext,
): ToolVerdictEvent => {
  const mcpServer = parseMcpServer(input.tool)
  const event: ToolVerdictEvent = {
    ...createEnvelope('tool.verdict', ctx, input.agentId ?? null),
    toolName: input.tool,
    toolUseId: input.tool_use_id,
    decision: result.decision,
    reason: result.reason ?? null,
    rule: result.rule ?? null,
    hook: result.hook ?? null,
    plugin: result.plugin ?? null,
    guard: profile ? parseGuardName(result.reason) : null,
  }
  if (input.tool === BASH_TOOL && typeof input.input.command === 'string') event.command = input.input.command
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

export const buildSessionEnd = (
  state: { reason?: string; estimates?: SessionEstimates },
  profile: boolean,
  ctx: EnvelopeContext,
): SessionEndEvent => {
  const event: SessionEndEvent = createEnvelope('session.end', ctx, null)
  if (state.reason !== undefined) event.reason = state.reason
  if (profile && state.estimates) event.estimates = state.estimates
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

export const buildPermissionOutcome = (
  input: { toolName: string; outcome: PermissionOutcome; toolUseId: string | null; agentId: string | null },
  ctx: EnvelopeContext,
): PermissionOutcomeEvent => ({
  ...createEnvelope('permission.outcome', ctx, input.agentId),
  toolName: input.toolName,
  outcome: input.outcome,
  toolUseId: input.toolUseId,
})
