export const SCHEMA_VERSION = 1

export type Schema = typeof SCHEMA_VERSION

/** Token counts of one turn, camelCase on disk (the host reports snake_case). */
export type UsageRecord = {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  model: string
}

export type Envelope<T extends string> = {
  schema: Schema
  id: string
  type: T
  ts: number
  sessionId: string
  /** `null` for the main loop. */
  agentId: string | null
  /** `null` when no branch can be determined. */
  branch: string | null
}

export type ToolDecision = 'allow' | 'deny' | 'ask'

export type ToolVerdictEvent = Envelope<'tool.verdict'> & {
  toolName: string
  toolUseId: string
  decision: ToolDecision
  reason: string | null
  rule: string | null
  hook: string | null
  plugin: string | null
  /** Profile field: `null` with the profile off. */
  guard: string | null
  /** Bash only, unredacted. */
  command?: string
  /** MCP tools only. */
  mcpServer?: string
}

export type PermissionOutcome = 'prompted' | 'denied' | 'completed' | 'failed'

export type PermissionOutcomeEvent = Envelope<'permission.outcome'> & {
  toolName: string
  outcome: PermissionOutcome
  toolUseId: string | null
}

export type AgentSpawnEvent = Envelope<'agent.spawn'> & {
  parentAgentId: string | null
  subagentType: string
  promptId: string
  promptBytes: number
  promptSha: string
  /** Profile field: `null` with the profile off, `[]` with it on and no block. */
  skillsInjected: string[] | null
}

export type AgentReportEvent = Envelope<'agent.report'> & {
  parentAgentId: string | null
  subagentType: string
  reportExcerpt: string
  /** The engine's end state; `null` only if the host omits it. */
  engineStatus: string | null
  /** Profile field: parsed from the envelope `status:` line. */
  status: string | null
  /** Profile field: `null` with the profile off. */
  parserVersion: number | null
}

export type TurnCompleteEvent = Envelope<'turn.complete'> & {
  durationMs: number
  usage: UsageRecord
  /** Main loop only: cost attributed to the turn, `null` when not derivable. */
  costUsd?: number | null
}

export type SessionStartEvent = Envelope<'session.start'> & {
  cwd: string
  /** The frozen profile flag: `true` or `false`, never `null`. */
  harnessProfile: boolean
  isInteractive?: boolean
}

export type BashPromptHookEstimate = {
  label: 'estimated'
  calls: number
  perCallUsd?: number
  usd?: number
}

export type SessionEstimates = {
  bashPromptHook: BashPromptHookEstimate
}

export type SessionEndEvent = Envelope<'session.end'> & {
  reason?: string
  /** Profile field: absent with the profile off. */
  estimates?: SessionEstimates
}

export type SessionCompactEvent = Envelope<'session.compact'>

export type SessionMeasureEvent = Envelope<'session.measure'> & {
  costUsd: number
  hasUnknownPrice: boolean
  context: object | null
  rateLimits: object | null
}

export type SkillUseKind = 'prompted' | 'read' | 'invoked'

export type SkillUseEvent = Envelope<'skill.use'> & {
  skill: string
  kind: SkillUseKind
}

export type CommandRunEvent = Envelope<'command.run'> & {
  name: string
}

export type DriftReason = 'agents-exceed-session' | 'unknown-price' | 'main-cost-missing'

export type ReconciliationEvent = Envelope<'reconciliation'> & {
  sumAgentsUsd: number
  sessionUsd: number
  /** `sessionUsd - sumAgentsUsd`, signed. */
  mainResidualUsd: number
  mainTokens: number
  drifted: boolean
  driftReasons: DriftReason[]
}

export type ObsEvent =
  | ToolVerdictEvent
  | PermissionOutcomeEvent
  | AgentSpawnEvent
  | AgentReportEvent
  | TurnCompleteEvent
  | SessionStartEvent
  | SessionEndEvent
  | SessionCompactEvent
  | SessionMeasureEvent
  | SkillUseEvent
  | CommandRunEvent
  | ReconciliationEvent

export type ObsEventType = ObsEvent['type']

export type ClosedReason = 'report' | 'reset'

/** `snapshots/<agentId>.json`, or `snapshots/main-<sessionId>.json` with `agentId: "main"`. Each write replaces the file. */
export type AgentSnapshot = {
  schema: Schema
  sessionId: string
  agentId: string
  parentAgentId: string | null
  subagentType: string
  model: string
  branch: string | null
  startedAt: number
  updatedAt: number
  usage: UsageRecord[]
  costUsd: number
  tokenCount: number
  hasUnknownPrice: boolean
  taskStatus: string | null
  closed: boolean
  closedReason: ClosedReason | null
}

/** One line of `prompts-YYYY-MM-DD.jsonl`; `promptId`, `sha`, `bytes` match the `agent.spawn` event. */
export type PromptRecord = {
  schema: Schema
  promptId: string
  sessionId: string
  ts: number
  agentId: string
  subagentType: string
  sha: string
  bytes: number
  text: string
}
