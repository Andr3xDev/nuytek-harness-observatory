import { FLUSH_INTERVAL_MS } from '../core/constants'
import { isoDay } from '../core/format'
import { isRecord } from '../core/guards'
import type { ObsEvent, PermissionOutcome, SkillUseKind } from '../core/schema'
import { mapUsage, type HostUsage } from '../core/usage'
import { eventsFileOf, mainSnapshotFileOf } from '../store/layout'
import type { StoredSnapshot } from '../store/read/snapshot-store'
import type { Batcher } from '../store/write/batcher'
import { resolveRetentionDays } from '../store/write/retention'
import type { Writer } from '../store/write/writer'
import { computeTurnCost, type Reading } from './cost/cost'
import { createBashCallTracker, type BashCallTracker } from './cost/estimates'
import { reconcile } from './cost/reconciliation'
import { parseSkillNameFromPath } from './events/parsers/skill-path'
import {
  buildCommandRun,
  buildPermissionOutcome,
  buildReconciliationRecord,
  buildReportRecord,
  buildSessionCompact,
  buildSessionEnd,
  buildSessionMeasure,
  buildSessionStart,
  buildSkillUse,
  buildSpawnRecord,
  buildTurnComplete,
  buildVerdictRecord,
  type EnvelopeContext,
  type ReportInput,
  type VerdictResult,
} from './events/records'
import type { BranchProvider } from './session/branch'
import {
  createSnapshotTracker,
  sweepStaleSnapshots,
  type SnapshotAgent,
  type SnapshotTracker,
} from './session/snapshots'

const BASH_TOOL = 'Bash'
const NO_MODEL = ''
/** Never matches a real `startedAt`, so a baseline built on it always takes the `computeTurnCost` reset path. */
const NO_STARTED_AT = -1
/** `session.end` shares one short wall-clock bound; snapshot upserts are skipped below this much remaining time. */
const SNAPSHOT_FLUSH_MIN_REMAINING_MS = 300

/**
 * What handlers read from `$` on every call. The plugin validator forbids passing `$` itself, so
 * each hook hands over closures that call `$.noun.event(...)` instead.
 */
export type HostApi = {
  sessionId: () => Promise<string>
  usage: () => Promise<{ startedAt: number; cost?: { usd: number; hasUnknownPrice?: true } }>
  agents: () => Promise<readonly SnapshotAgent[]>
  /** The session's model; optional at runtime, a host without it records `''`. */
  model: () => Promise<string>
}

/** Reads the stored snapshots for the resume sweep; supplied by the `session.start` hook only. */
export type SnapshotLister = { listSnapshots: () => Promise<StoredSnapshot[]> }

/** Process-wide collaborators, built once from the first host a hook receives. */
export type Runtime = {
  batcher: Batcher
  writer: Pick<Writer, 'init' | 'maintain'>
  branch: BranchProvider
}

export type CaptureConfig<H extends HostApi> = {
  /** Frozen once at register; anything but `true` is off. */
  profile: boolean
  retentionDays: string | undefined
  runtime: (host: H) => Runtime
  now?: () => number
}

type Next<E, R> = (e: E) => Promise<R>
type BudgetedNext<E, R> = Next<E, R> & { budget?: { remainingMs: number } }

type Sample = {
  startedAt: number
  sessionUsd: number
  /** False when the host reported no session cost: a missing reading, not a zero one (D14). */
  sessionCostKnown: boolean
  hasUnknownPrice: boolean
  agents: readonly SnapshotAgent[]
  model: string
}

// A missing `$.session.model` throws synchronously, so the call sits inside the try.
const readModel = async (host: HostApi): Promise<string> => {
  try {
    return await host.model()
  } catch {
    return ''
  }
}

type CaptureSession = { id: string; tracker: SnapshotTracker; cwd: string }

type ToolCheckInput = { tool: string; input: unknown; tool_use_id?: string; agentId?: string }
type TurnInput = { durationMs: number; agentId?: string; usage?: HostUsage }
type PermissionInput = { tool_name: string; tool_use_id?: string; agent_id?: string }

// The snapshot schema needs a number per agent, so an agent without `cost` still counts as 0 here.
const toReading = (sample: Sample): Reading | null =>
  sample.sessionCostKnown
    ? {
        startedAt: sample.startedAt,
        sessionUsd: sample.sessionUsd,
        hasUnknownPrice: sample.hasUnknownPrice,
        agents: new Map(sample.agents.map((agent) => [agent.id, agent.cost?.usd ?? 0])),
      }
    : null

const ZERO_BASELINE_AGENTS: ReadonlyMap<string, number> = new Map()

const skillUseOf = (tool: string, input: unknown): { skill: string; kind: SkillUseKind } | null => {
  if (!isRecord(input)) return null
  if (tool === 'Read' && typeof input.file_path === 'string') {
    const skill = parseSkillNameFromPath(input.file_path)
    return skill ? { skill, kind: 'read' } : null
  }
  if (tool === 'Skill' && typeof input.skill === 'string') return { skill: input.skill, kind: 'invoked' }
  return null
}

export const createCapture = <H extends HostApi>(config: CaptureConfig<H>) => {
  const { profile } = config
  const now = config.now ?? Date.now
  const lastKnownAgentUsd = new Map<string, number>()
  // Built by the first hook that touches it, normally `session.start`. After a module reload with no
  // `session.start` it is built in another dispatch, so that host's closures own the timer and writer.
  let runtime: Runtime | undefined
  let session: CaptureSession | undefined
  // Survives `/clear`, which ends the session without a `session.start` for the next one.
  let lastCwd = '.'
  let baseline: Reading | null = null
  let previousModel = NO_MODEL
  let lastCycleAt = 0
  let bashCalls: BashCallTracker = createBashCallTracker(profile)

  const runtimeOf = (host: H): Runtime => (runtime ??= config.runtime(host))

  const startSession = (id: string): CaptureSession => (session = { id, tracker: createSnapshotTracker(id), cwd: lastCwd })

  // `/resume` ends the old session without a `session.start` for the resumed one, so the first event
  // that sees a different host session id adopts it, with a baseline taken at the resume point.
  const sessionOf = async (host: H): Promise<CaptureSession> => {
    const id = await host.sessionId()
    if (session?.id === id) return session
    // After `/clear` or before any session the existing baseline is already the right one.
    if (session === undefined) return startSession(id)
    lastKnownAgentUsd.clear()
    // Sampled before the new id is assigned, so an event racing this one never sees the new id with the old baseline.
    const sample = await takeSample(host)
    // A concurrent event may have adopted the id while this one sampled.
    if (session?.id === id) return session
    previousModel = NO_MODEL
    bashCalls = createBashCallTracker(profile)
    baseline = sample ? toReading(sample) : null
    return startSession(id)
  }

  const contextOf = (state: CaptureSession, rt: Runtime): EnvelopeContext => ({
    sessionId: state.id,
    branch: rt.branch.current(),
    now: now(),
  })

  const takeSample = async (host: H): Promise<Sample | null> => {
    try {
      const [usage, agents, model] = await Promise.all([host.usage(), host.agents(), readModel(host)])
      for (const agent of agents) if (agent.cost) lastKnownAgentUsd.set(agent.id, agent.cost.usd)
      return {
        startedAt: usage.startedAt,
        sessionUsd: usage.cost?.usd ?? 0,
        sessionCostKnown: usage.cost !== undefined,
        hasUnknownPrice: usage.cost?.hasUnknownPrice === true,
        agents,
        model,
      }
    } catch {
      return null
    }
  }

  const runCycle = (state: CaptureSession, rt: Runtime, sample: Sample): void => {
    lastCycleAt = now()
    const writes = state.tracker.cycle({ ...sample, branch: rt.branch.current(), now: lastCycleAt })
    for (const write of writes) rt.batcher.setSnapshot(write.file, write.snapshot)
  }

  /** Host result first and unchanged; capture failures never reach the caller. */
  const observe = async <E, R>(e: E, next: Next<E, R>, record: (result: R) => Promise<void> | void): Promise<R> => {
    const result = await next(e)
    try {
      await record(result)
    } catch {
      // Capture is best effort: a failed record must not change what the host decided.
    }
    return result
  }

  return {
    /** Read-only view for the live panel: events accepted by the batcher but not yet on disk. */
    pendingEvents: (sessionId: string): readonly ObsEvent[] => runtime?.batcher.pendingEvents(sessionId) ?? [],

    sessionStart: <E extends { cwd: string; isInteractive?: boolean }, R extends { cwd?: string }>(
      host: H & SnapshotLister,
      e: E,
      next: Next<E, R>,
    ) =>
      observe(e, next, async (result) => {
        const rt = runtimeOf(host)
        const state = startSession(await host.sessionId())
        state.cwd = result.cwd ?? e.cwd
        lastCwd = state.cwd
        bashCalls = createBashCallTracker(profile)
        previousModel = NO_MODEL
        await rt.writer.init()
        await rt.branch.refresh(state.cwd)
        const sample = await takeSample(host)
        baseline = sample ? toReading(sample) : null
        rt.batcher.pushEvent(buildSessionStart(e, profile, contextOf(state, rt)))
        void rt.writer.maintain(resolveRetentionDays(config.retentionDays), eventsFileOf(state.id), mainSnapshotFileOf(state.id))
        for (const write of sweepStaleSnapshots(state.id, await host.listSnapshots(), now())) {
          rt.batcher.setSnapshot(write.file, write.snapshot)
        }
      }),

    sessionEnd: <E extends { sessionId: string; reason: string }, R>(host: H, e: E, next: BudgetedNext<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        const ctx: EnvelopeContext = { sessionId: e.sessionId, branch: rt.branch.current(), now: now() }
        if (e.reason === 'clear') {
          for (const write of session?.tracker.closeAllOnReset(ctx.now) ?? []) rt.batcher.setSnapshot(write.file, write.snapshot)
          session = undefined
          previousModel = NO_MODEL
          lastKnownAgentUsd.clear()
          // No `session.start` follows a `/clear`: a zero baseline makes the first turn cost the new cumulative (D14 reset).
          baseline = { startedAt: NO_STARTED_AT, sessionUsd: 0, hasUnknownPrice: false, agents: ZERO_BASELINE_AGENTS }
        }
        rt.batcher.pushEvent(buildSessionEnd({ reason: e.reason, estimates: bashCalls.estimate() }, profile, ctx))
        if (e.reason === 'clear') bashCalls = createBashCallTracker(profile)
        // Events are appended first; snapshots are the part dropped when the shared bound runs low.
        await rt.batcher.flush(() => (next.budget?.remainingMs ?? Infinity) > SNAPSHOT_FLUSH_MIN_REMAINING_MS)
      }),

    sessionCompact: <E, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        rt.batcher.pushEvent(buildSessionCompact(contextOf(await sessionOf(host), rt)))
      }),

    commandRun: <E extends { command: string }, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        rt.batcher.pushEvent(buildCommandRun({ name: e.command }, contextOf(await sessionOf(host), rt)))
      }),

    skillPrompt: <E extends { skill: string }, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        const ctx = contextOf(await sessionOf(host), rt)
        rt.batcher.pushEvent(buildSkillUse({ skill: e.skill, kind: 'prompted', agentId: null }, ctx))
      }),

    agentSpawn: <
      E extends { prompt: string; subagentType: string; parentAgentId?: string },
      R extends { agentId?: string; deny?: string },
    >(
      host: H,
      e: E,
      next: Next<E, R>,
    ) =>
      observe(e, next, async (result) => {
        if (result.deny !== undefined || result.agentId === undefined) return
        const rt = runtimeOf(host)
        const ctx = contextOf(await sessionOf(host), rt)
        const { event, prompt } = await buildSpawnRecord(e, { agentId: result.agentId }, profile, ctx)
        rt.batcher.pushEvent(event)
        rt.batcher.pushPrompt(isoDay(ctx.now), prompt)
      }),

    agentReport: <E extends ReportInput, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        const state = await sessionOf(host)
        const ctx = contextOf(state, rt)
        rt.batcher.pushEvent(buildReportRecord(e, profile, ctx))
        const sample = await takeSample(host)
        if (sample) {
          for (const write of state.tracker.closeAgent(e.agentId, { ...sample, branch: ctx.branch, now: ctx.now })) {
            rt.batcher.setSnapshot(write.file, write.snapshot)
          }
        }
        void rt.batcher.flush() // never waits on disk; flush is serialized and never rejects
      }),

    turnComplete: <E extends TurnInput, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        const state = await sessionOf(host)
        if (e.agentId !== undefined) {
          rt.batcher.pushEvent(buildTurnComplete(e, contextOf(state, rt), { costUsd: null, previousModel }))
          if (now() - lastCycleAt >= FLUSH_INTERVAL_MS) {
            const sample = await takeSample(host)
            if (sample) runCycle(state, rt, sample)
          }
          return
        }

        await rt.branch.refresh(state.cwd)
        const sample = await takeSample(host)
        const costUsd = computeTurnCost(baseline, sample ? toReading(sample) : null, lastKnownAgentUsd)
        baseline = sample ? toReading(sample) : null
        // The first cycle detects a `startedAt` reset and clears the ledger before this turn is recorded.
        if (sample) runCycle(state, rt, sample)
        if (e.usage) {
          state.tracker.recordMainTurn(mapUsage(e.usage))
          previousModel = e.usage.model
          if (sample) runCycle(state, rt, sample)
        }
        rt.batcher.pushEvent(buildTurnComplete(e, contextOf(state, rt), { costUsd, previousModel }))
        void rt.batcher.flush() // never waits on disk; flush is serialized and never rejects
      }),

    sessionMeasure: <E extends { cost?: { usd: number; hasUnknownPrice?: true }; context?: object; rateLimits?: object }, R>(
      host: H,
      e: E,
      next: Next<E, R>,
    ) =>
      observe(e, next, async () => {
        if (!e.cost) return
        const rt = runtimeOf(host)
        const state = await sessionOf(host)
        const ctx = contextOf(state, rt)
        const hasUnknownPrice = e.cost.hasUnknownPrice === true
        rt.batcher.pushEvent(
          buildSessionMeasure({ costUsd: e.cost.usd, hasUnknownPrice, context: e.context, rateLimits: e.rateLimits }, ctx),
        )
        const sample = await takeSample(host)
        if (!sample) return
        const result = reconcile({
          sessionUsd: e.cost.usd,
          hasUnknownPrice,
          agents: sample.agents.map((agent) => ({ usd: agent.cost?.usd ?? 0, hasUnknownPrice: agent.cost?.hasUnknownPrice })),
          mainTokens: state.tracker.mainTokens(),
        })
        rt.batcher.pushEvent(buildReconciliationRecord(result, ctx))
      }),

    toolCheck: <E extends ToolCheckInput, R extends VerdictResult>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async (result) => {
        if (e.tool_use_id === undefined) return
        const rt = runtimeOf(host)
        const ctx = contextOf(await sessionOf(host), rt)
        const input = isRecord(e.input) ? e.input : {}
        rt.batcher.pushEvent(
          buildVerdictRecord({ tool: e.tool, input, tool_use_id: e.tool_use_id, agentId: e.agentId }, result, profile, ctx),
        )
        if (e.tool === BASH_TOOL) bashCalls.recordVerdict(e.tool, e.tool_use_id)
        const skillUse = skillUseOf(e.tool, e.input)
        if (skillUse) rt.batcher.pushEvent(buildSkillUse({ ...skillUse, agentId: e.agentId ?? null }, ctx))
      }),

    /** Classic permission hook body; registered only behind `CLASSIC_PERMISSION_HOOKS_ENABLED`. */
    permissionOutcome:
      (outcome: PermissionOutcome) =>
      <E extends PermissionInput, R>(host: H, e: E, next: Next<E, R>) =>
        observe(e, next, async () => {
          const rt = runtimeOf(host)
          const ctx = contextOf(await sessionOf(host), rt)
          rt.batcher.pushEvent(
            buildPermissionOutcome(
              { toolName: e.tool_name, outcome, toolUseId: e.tool_use_id ?? null, agentId: e.agent_id ?? null },
              ctx,
            ),
          )
        }),
  }
}
