import type {
  AgentReportEvent,
  AgentSpawnEvent,
  CommandRunEvent,
  Envelope,
  SessionEndEvent,
  SessionMeasureEvent,
  SessionStartEvent,
  SkillUseEvent,
  ToolVerdictEvent,
  TurnCompleteEvent,
  UsageRecord,
} from '../../core/schema'
import { SESSION_ID } from '../../core/test-fixtures'

export { SESSION_ID }
export const NOW = 1_000_000_000_000
export const HOUR_MS = 60 * 60 * 1000

let sequence = 0

const envelope = <T extends string>(type: T, overrides: Partial<Envelope<T>>): Envelope<T> => {
  sequence += 1
  return { schema: 1, id: `e${sequence}`, type, ts: sequence, sessionId: SESSION_ID, agentId: null, branch: null, ...overrides }
}

export const usage = (input: number, output: number, cacheRead: number, cacheCreation: number, model = 'm1'): UsageRecord => ({
  input,
  output,
  cacheRead,
  cacheCreation,
  model,
})

export const sessionStart = (overrides: Partial<SessionStartEvent> = {}): SessionStartEvent => ({
  ...envelope('session.start', {}),
  cwd: '/w',
  harnessProfile: false,
  ...overrides,
})

export const sessionEnd = (overrides: Partial<SessionEndEvent> = {}): SessionEndEvent => ({ ...envelope('session.end', {}), ...overrides })

export const sessionMeasure = (overrides: Partial<SessionMeasureEvent> = {}): SessionMeasureEvent => ({
  ...envelope('session.measure', {}),
  costUsd: 0,
  hasUnknownPrice: false,
  context: null,
  rateLimits: null,
  ...overrides,
})

export const spawn = (agentId: string, overrides: Partial<AgentSpawnEvent> = {}): AgentSpawnEvent => ({
  ...envelope('agent.spawn', { agentId }),
  parentAgentId: null,
  subagentType: 'builder',
  skillsInjected: null,
  ...overrides,
})

export const report = (agentId: string, overrides: Partial<AgentReportEvent> = {}): AgentReportEvent => ({
  ...envelope('agent.report', { agentId }),
  parentAgentId: null,
  subagentType: 'builder',
  engineStatus: 'completed',
  ...overrides,
})

export const turn = (agentId: string | null, overrides: Partial<TurnCompleteEvent> = {}): TurnCompleteEvent => ({
  ...envelope('turn.complete', { agentId }),
  durationMs: 1000,
  usage: usage(0, 0, 0, 0),
  ...overrides,
})

export const verdict = (toolUseId: string, overrides: Partial<ToolVerdictEvent> = {}): ToolVerdictEvent => ({
  ...envelope('tool.verdict', {}),
  toolName: 'Bash',
  toolUseId,
  ...overrides,
})

export const skillUse = (skill: string, kind: SkillUseEvent['kind'], agentId: string | null = null): SkillUseEvent => ({
  ...envelope('skill.use', { agentId }),
  skill,
  kind,
})

export const commandRun = (name: string): CommandRunEvent => ({ ...envelope('command.run', {}), name })

export { mainSnapshot, snapshot } from '../../core/test-fixtures'
