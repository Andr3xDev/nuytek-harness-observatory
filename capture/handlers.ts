import type { Batcher } from '../store/batcher'
import { resolveRetentionDays } from '../store/retention'
import type { Writer } from '../store/writer'
import type { BranchProvider } from './branch'
import { FLUSH_INTERVAL_MS } from './constants'
import { computeTurnCost, type Reading } from './cost'
import { createBashCallTracker, type BashCallTracker } from './estimates'
import { parseSkillNameFromPath } from './parsers/skill-path'
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
  mapUsage,
  type EnvelopeContext,
  type HostUsage,
  type ReportInput,
  type VerdictResult,
} from './records'
import { reconcile } from './reconciliation'
import type { PermissionOutcome, SkillUseKind } from './schema'
import {
  createSnapshotTracker,
  sweepStaleSnapshots,
  type SnapshotAgent,
  type SnapshotTracker,
  type StoredSnapshot,
} from './snapshots'

const BASH_TOOL = 'Bash'
const ISO_DATE_LENGTH = 10
const NO_MODEL = ''

/**
 * What handlers read from `$` on every call. The plugin validator forbids passing `$` itself, so
 * each hook hands over closures that call `$.noun.event(...)` instead.
 */
export type HostApi = {
  sessionId: () => Promise<string>
  usage: () => Promise<{ startedAt: number; cost?: { usd: number; hasUnknownPrice?: true } }>
  agents: () => Promise<readonly SnapshotAgent[]>
}

/** Reads the stored snapshots for the resume sweep; supplied by the `session.start` hook only. */
export type SnapshotLister = { listSnapshots: () => Promise<StoredSnapshot[]> }

/** Process-wide collaborators, built once from the first host a hook receives. */
export type Runtime = {
  batcher: Batcher
  writer: Pick<Writer, 'maintain'>
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

type Sample = {
  startedAt: number
  sessionUsd: number
  hasUnknownPrice: boolean
  agents: readonly SnapshotAgent[]
}

type SessionState = { id: string; tracker: SnapshotTracker; cwd: string }

type ToolCheckInput = { tool: string; input: unknown; tool_use_id?: string; agentId?: string }
type TurnInput = { durationMs: number; agentId?: string; usage?: HostUsage }
type PermissionInput = { tool_name: string; tool_use_id?: string; agent_id?: string }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const toReading = (sample: Sample): Reading => ({
  startedAt: sample.startedAt,
  sessionUsd: sample.sessionUsd,
  hasUnknownPrice: sample.hasUnknownPrice,
  agents: new Map(sample.agents.map((agent) => [agent.id, agent.cost?.usd ?? 0])),
})

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
  let runtime: Runtime | undefined
  let session: SessionState | undefined
  let baseline: Reading | null = null
  let previousModel = NO_MODEL
  let lastCycleAt = 0
  let bashCalls: BashCallTracker = createBashCallTracker(profile)

  const runtimeOf = (host: H): Runtime => (runtime ??= config.runtime(host))

  const startSession = (id: string): SessionState => (session = { id, tracker: createSnapshotTracker(id), cwd: '.' })

  const sessionOf = async (host: H): Promise<SessionState> => session ?? startSession(await host.sessionId())

  const contextOf = (state: SessionState, rt: Runtime): EnvelopeContext => ({
    sessionId: state.id,
    branch: rt.branch.current(),
    now: now(),
  })

  const takeSample = async (host: H): Promise<Sample | null> => {
    try {
      const [usage, agents] = await Promise.all([host.usage(), host.agents()])
      for (const agent of agents) lastKnownAgentUsd.set(agent.id, agent.cost?.usd ?? 0)
      return {
        startedAt: usage.startedAt,
        sessionUsd: usage.cost?.usd ?? 0,
        hasUnknownPrice: usage.cost?.hasUnknownPrice === true,
        agents,
      }
    } catch {
      return null
    }
  }

  const runCycle = (state: SessionState, rt: Runtime, sample: Sample): void => {
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
    sessionStart: <E extends { cwd: string; isInteractive?: boolean }, R extends { cwd?: string }>(
      host: H & SnapshotLister,
      e: E,
      next: Next<E, R>,
    ) =>
      observe(e, next, async (result) => {
        const rt = runtimeOf(host)
        const state = startSession(await host.sessionId())
        state.cwd = result.cwd ?? e.cwd
        bashCalls = createBashCallTracker(profile)
        previousModel = NO_MODEL
        await rt.branch.refresh(state.cwd)
        const sample = await takeSample(host)
        baseline = sample ? toReading(sample) : null
        rt.batcher.pushEvent(buildSessionStart(e, profile, contextOf(state, rt)))
        void rt.writer.maintain(resolveRetentionDays(config.retentionDays), `${state.id}.jsonl`, `main-${state.id}.json`)
        for (const write of sweepStaleSnapshots(state.id, await host.listSnapshots(), now())) {
          rt.batcher.setSnapshot(write.file, write.snapshot)
        }
      }),

    sessionEnd: <E extends { sessionId: string; reason: string }, R>(host: H, e: E, next: Next<E, R>) =>
      observe(e, next, async () => {
        const rt = runtimeOf(host)
        const ctx: EnvelopeContext = { sessionId: e.sessionId, branch: rt.branch.current(), now: now() }
        if (e.reason === 'clear') {
          for (const write of session?.tracker.closeAllOnReset(ctx.now) ?? []) rt.batcher.setSnapshot(write.file, write.snapshot)
          session = undefined
          baseline = null
        }
        rt.batcher.pushEvent(buildSessionEnd({ reason: e.reason, estimates: bashCalls.estimate() }, profile, ctx))
        if (e.reason === 'clear') bashCalls = createBashCallTracker(profile)
        await rt.batcher.flush()
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
        rt.batcher.pushPrompt(new Date(ctx.now).toISOString().slice(0, ISO_DATE_LENGTH), prompt)
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
        await rt.batcher.flush()
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
        await rt.batcher.flush()
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
