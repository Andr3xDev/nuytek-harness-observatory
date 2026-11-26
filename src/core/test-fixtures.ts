import type { AgentSnapshot } from './schema'

export const SESSION_ID = 's1'

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
