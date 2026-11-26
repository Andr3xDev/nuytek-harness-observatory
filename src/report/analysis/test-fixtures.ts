import type {
  AgentReportEvent,
  AgentSnapshot,
  AgentSpawnEvent,
  CommandRunEvent,
  Envelope,
  SessionEndEvent,
  SessionStartEvent,
  SkillUseEvent,
  ToolVerdictEvent,
  TurnCompleteEvent,
  UsageRecord,
} from '../../core/schema'
import type { SessionContext } from './types'

export const SESSION_ID = 's1'
export const NOW = 1_000_000_000_000
export const HOUR_MS = 60 * 60 * 1000
/** Context for a closed or recently active session; `sourceMtimeMs` is one minute old. */
export const CTX: SessionContext = { now: NOW, sourceMtimeMs: NOW - 60_000 }

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

export const spawn = (agentId: string, overrides: Partial<AgentSpawnEvent> = {}): AgentSpawnEvent => ({
  ...envelope('agent.spawn', { agentId }),
  parentAgentId: null,
  subagentType: 'builder',
  promptId: `p-${agentId}`,
  promptBytes: 10,
  promptSha: 'sha',
  skillsInjected: null,
  ...overrides,
})

export const report = (agentId: string, overrides: Partial<AgentReportEvent> = {}): AgentReportEvent => ({
  ...envelope('agent.report', { agentId }),
  parentAgentId: null,
  subagentType: 'builder',
  reportExcerpt: 'done',
  engineStatus: 'completed',
  status: null,
  parserVersion: null,
  ...overrides,
})

export const turn = (agentId: string | null, overrides: Partial<TurnCompleteEvent> = {}): TurnCompleteEvent => ({
  ...envelope('turn.complete', { agentId }),
  durationMs: 1000,
  usage: usage(0, 0, 0, 0),
  ...overrides,
})

export const verdict = (toolUseId: string, decision: ToolVerdictEvent['decision'], overrides: Partial<ToolVerdictEvent> = {}): ToolVerdictEvent => ({
  ...envelope('tool.verdict', {}),
  toolName: 'Bash',
  toolUseId,
  decision,
  reason: null,
  rule: null,
  hook: null,
  plugin: null,
  guard: null,
  ...overrides,
})

export const skillUse = (skill: string, kind: SkillUseEvent['kind'], agentId: string | null = null): SkillUseEvent => ({
  ...envelope('skill.use', { agentId }),
  skill,
  kind,
})

export const commandRun = (name: string): CommandRunEvent => ({ ...envelope('command.run', {}), name })

export const snapshot = (agentId: string, overrides: Partial<AgentSnapshot> = {}): AgentSnapshot => ({
  schema: 1,
  sessionId: SESSION_ID,
  agentId,
  parentAgentId: null,
  subagentType: 'builder',
  model: 'm1',
  branch: null,
  startedAt: 1,
  updatedAt: 2,
  usage: [],
  costUsd: 0,
  tokenCount: 0,
  hasUnknownPrice: false,
  taskStatus: null,
  closed: false,
  closedReason: null,
  ...overrides,
})

/** The main-loop snapshot is `snapshots/main-<sessionId>.json` with `agentId: "main"`. */
export const mainSnapshot = (overrides: Partial<AgentSnapshot> = {}): AgentSnapshot =>
  snapshot('main', { subagentType: 'main', ...overrides })
