import { RESUME_SWEEP_WINDOW_MS } from '../../core/constants'
import { SCHEMA_VERSION, type AgentSnapshot, type ClosedReason, type UsageRecord } from '../../core/schema'
import { mapUsage, type HostUsage } from '../../core/usage'
import { agentSnapshotFileOf, mainSnapshotFileOf } from '../../store/layout'
import type { StoredSnapshot } from '../../store/read/snapshot-store'

const MAIN_AGENT_ID = 'main'

/** The `$.agent.list()` fields a snapshot needs. */
export type SnapshotAgent = {
  id: string
  type: string
  parentId?: string
  taskStatus: string | null
  tokenCount: number
  usage?: HostUsage[]
  cost?: { usd: number; hasUnknownPrice?: boolean }
  model?: string
  effort?: string | number
  /** Fallback for `model` and `effort`: the row leaves `effort` out for agents that inherit the session's. */
  lastRequest?: { model: string; effort?: string | number }
}

export type SnapshotCycleInput = {
  branch: string | null
  now: number
  /** `startedAt` of `$.session.usage()`. */
  startedAt: number
  sessionUsd: number
  /** False when the host reported no session cost: `sessionUsd` is then a placeholder, not a reading (D14). */
  sessionCostKnown?: boolean
  hasUnknownPrice: boolean
  agents: readonly SnapshotAgent[]
}

export type SnapshotWrite = { file: string; snapshot: AgentSnapshot }

export type SnapshotTracker = {
  recordMainTurn: (usage: UsageRecord) => void
  /** Sum of the four token fields over the main-loop ledger of the current `startedAt`. */
  mainTokens: () => number
  cycle: (input: SnapshotCycleInput) => SnapshotWrite[]
  closeAgent: (agentId: string, input: SnapshotCycleInput) => SnapshotWrite[]
  closeAllOnReset: (now: number) => SnapshotWrite[]
}

type Tracked = { snapshot: AgentSnapshot; signature: string }

const signatureOf = (snapshot: AgentSnapshot): string =>
  JSON.stringify([snapshot.usage.length, snapshot.tokenCount, snapshot.costUsd, snapshot.taskStatus, snapshot.effort])

const closeSnapshot = (snapshot: AgentSnapshot, reason: ClosedReason, now: number): AgentSnapshot => ({
  ...snapshot,
  updatedAt: now,
  closed: true,
  closedReason: reason,
})

export const createSnapshotTracker = (sessionId: string): SnapshotTracker => {
  const mainFile = mainSnapshotFileOf(sessionId)
  let tracked = new Map<string, Tracked>()
  let ledger: UsageRecord[] = []
  let startedAt: number | undefined

  const ledgerTokens = (): number =>
    ledger.reduce((sum, turn) => sum + turn.input + turn.output + turn.cacheRead + turn.cacheCreation, 0)

  const agentSnapshot = (agent: SnapshotAgent, input: SnapshotCycleInput): AgentSnapshot => {
    const usage = (agent.usage ?? []).map(mapUsage)
    const effort = agent.effort ?? agent.lastRequest?.effort
    return {
      schema: SCHEMA_VERSION,
      sessionId,
      agentId: agent.id,
      parentAgentId: agent.parentId ?? null,
      subagentType: agent.type,
      model: agent.model ?? agent.lastRequest?.model ?? usage.at(-1)?.model ?? '',
      ...(effort !== undefined && { effort }),
      branch: input.branch,
      startedAt: input.startedAt,
      updatedAt: input.now,
      usage,
      costUsd: agent.cost?.usd ?? 0,
      tokenCount: agent.tokenCount,
      hasUnknownPrice: agent.cost?.hasUnknownPrice ?? false,
      taskStatus: agent.taskStatus,
      closed: false,
      closedReason: null,
    }
  }

  // Unknown session cost: no residual can be derived, so main stays at 0 and is flagged unknown.
  // The residual is floored at 0 because agents can transiently exceed the session figure.
  const mainCostUsd = (input: SnapshotCycleInput): number =>
    input.sessionCostKnown === false
      ? 0
      : Math.max(0, input.sessionUsd - input.agents.reduce((sum, agent) => sum + (agent.cost?.usd ?? 0), 0))

  const mainSnapshot = (input: SnapshotCycleInput): AgentSnapshot => ({
    schema: SCHEMA_VERSION,
    sessionId,
    agentId: MAIN_AGENT_ID,
    parentAgentId: null,
    subagentType: MAIN_AGENT_ID,
    model: ledger.at(-1)?.model ?? '',
    branch: input.branch,
    startedAt: input.startedAt,
    updatedAt: input.now,
    usage: [...ledger],
    costUsd: mainCostUsd(input),
    tokenCount: ledgerTokens(),
    hasUnknownPrice: input.hasUnknownPrice || input.sessionCostKnown === false,
    taskStatus: null,
    closed: false,
    closedReason: null,
  })

  const closeOpen = (now: number): SnapshotWrite[] => {
    const writes = [...tracked]
      .filter(([, entry]) => !entry.snapshot.closed)
      .map(([file, entry]) => ({ file, snapshot: closeSnapshot(entry.snapshot, 'reset', now) }))
    tracked = new Map()
    ledger = []
    startedAt = undefined
    return writes
  }

  const writeIfChanged = (file: string, snapshot: AgentSnapshot): SnapshotWrite[] => {
    const signature = signatureOf(snapshot)
    if (tracked.get(file)?.signature === signature) return []
    tracked.set(file, { snapshot, signature })
    return [{ file, snapshot }]
  }

  return {
    recordMainTurn: (usage) => {
      ledger.push(usage)
    },
    mainTokens: ledgerTokens,
    cycle: (input) => {
      const writes = startedAt !== undefined && startedAt !== input.startedAt ? closeOpen(input.now) : []
      startedAt = input.startedAt
      for (const agent of input.agents) {
        const file = agentSnapshotFileOf(agent.id)
        if (!tracked.get(file)?.snapshot.closed) writes.push(...writeIfChanged(file, agentSnapshot(agent, input)))
      }
      writes.push(...writeIfChanged(mainFile, mainSnapshot(input)))
      return writes
    },
    closeAgent: (agentId, input) => {
      const file = agentSnapshotFileOf(agentId)
      const agent = input.agents.find((candidate) => candidate.id === agentId)
      const base = agent ? agentSnapshot(agent, input) : tracked.get(file)?.snapshot
      if (!base) return []
      const snapshot = closeSnapshot(base, 'report', input.now)
      tracked.set(file, { snapshot, signature: signatureOf(snapshot) })
      return [{ file, snapshot }]
    },
    closeAllOnReset: closeOpen,
  }
}

/** Closes open snapshots of this session written within the resume window: their usage predates this process. */
export const sweepStaleSnapshots = (
  sessionId: string,
  files: readonly StoredSnapshot[],
  now: number,
): SnapshotWrite[] =>
  files
    .filter((file) => file.snapshot.sessionId === sessionId && !file.snapshot.closed && now - file.mtimeMs <= RESUME_SWEEP_WINDOW_MS)
    .map((file) => ({ file: file.name, snapshot: { ...file.snapshot, closed: true, closedReason: 'reset' } }))
