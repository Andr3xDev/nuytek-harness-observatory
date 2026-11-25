import type { AgentReportEvent, AgentSpawnEvent, TurnCompleteEvent, UsageRecord } from '../capture/schema'
import { UNATTRIBUTED_ISSUE, issueKeyOf } from './issue'
import { mergeLiveEvents } from './live'
import {
  MAX_COMMAND_CHARS,
  OPEN_SESSION_MAX_IDLE_MS,
  ROLLUP_MAX_BASH_COMMANDS,
  type AgentFigures,
  type EventRecord,
  type Figure,
  type ProfileFigures,
  type SessionContext,
  type SessionFigures,
  type SessionInput,
  type SessionState,
  type SkillFigures,
  type TokenCounts,
  type ToolFigures,
  type TreeFigures,
  type TypeFigures,
} from './types'

const MAIN_AGENT_TYPE = 'main'
const UNKNOWN_KEY = 'unknown'
const CODE_REVIEWER_TYPE = 'code-reviewer'
const FINAL_ENGINE_STATUSES = ['completed', 'failed', 'stopped']

/** Report-text markers are matched on the excerpt; changing them needs a ROLLUP_VERSION bump. */
const REROUTE_RULES = new Map([
  ['quick-builder', { status: 'blocked', marker: 'needs-builder' }],
  ['test-writer', { status: 'blocked', marker: 'tests-not-worth-it' }],
])

type AgentRecord = { spawn: AgentSpawnEvent; report: AgentReportEvent | null; durationMs: number }
type Source = { usage: readonly UsageRecord[]; costUsd: number; hasUnknownPrice: boolean }

const zeroTokens = (): TokenCounts => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0 })
const emptyFigure = (): Figure => ({ ...zeroTokens(), tokens: 0, costUsd: 0, hasUnknownPrice: false })

const addTokens = (target: TokenCounts, part: TokenCounts): void => {
  target.input += part.input
  target.output += part.output
  target.cacheRead += part.cacheRead
  target.cacheCreation += part.cacheCreation
}

const addFigure = (target: Figure, part: Figure): void => {
  addTokens(target, part)
  target.tokens += part.tokens
  target.costUsd += part.costUsd
  target.hasUnknownPrice ||= part.hasUnknownPrice
}

const figureOf = ({ usage, costUsd, hasUnknownPrice }: Source): Figure => {
  const figure: Figure = { ...emptyFigure(), costUsd, hasUnknownPrice }
  for (const record of usage) addTokens(figure, record)
  figure.tokens = figure.input + figure.output + figure.cacheRead + figure.cacheCreation
  return figure
}

/** Records keyed by event text must not inherit `constructor`, `__proto__` and friends. */
export const createRecord = <T>(): Record<string, T> => Object.create(null) as Record<string, T>

const getOrInit =<T>(record: Record<string, T>, key: string, make: () => T): T => (record[key] ??= make())
const bump = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1
}

export function classifySession(events: EventRecord[], sourceMtimeMs: number, now: number): SessionState {
  if (events.some((event) => event.type === 'session.end')) return 'closed'
  return now - sourceMtimeMs <= OPEN_SESSION_MAX_IDLE_MS ? 'open' : 'stale'
}

const collectAgents = (events: readonly EventRecord[]): Map<string, AgentRecord> => {
  const agents = new Map<string, AgentRecord>()
  for (const event of events) {
    if (event.type === 'agent.spawn' && event.agentId !== null && !agents.has(event.agentId)) {
      agents.set(event.agentId, { spawn: event, report: null, durationMs: 0 })
    }
  }
  for (const event of events) {
    const agent = event.agentId === null ? undefined : agents.get(event.agentId)
    if (!agent) continue
    if (event.type === 'agent.report') agent.report = event
    if (event.type === 'turn.complete') agent.durationMs += event.durationMs
  }
  return agents
}

const engineStatusOf = (report: AgentReportEvent | null): AgentFigures['engineStatus'] => {
  if (!report) return 'running'
  const status = report.engineStatus
  return status !== null && FINAL_ENGINE_STATUSES.includes(status) ? (status as AgentFigures['engineStatus']) : 'unknown'
}

/** Walks up `parentAgentId`; a cycle resolves to its earliest-spawned member so every member shares one root. */
const rootOf = (agentId: string, agents: Map<string, AgentRecord>, order: string[]): string => {
  const path: string[] = []
  let current = agentId
  for (;;) {
    path.push(current)
    const parent = agents.get(current)?.spawn.parentAgentId ?? null
    if (parent === null || !agents.has(parent)) return current
    const cycleStart = path.indexOf(parent)
    if (cycleStart !== -1) {
      return path.slice(cycleStart).reduce((first, id) => (order.indexOf(id) < order.indexOf(first) ? id : first))
    }
    current = parent
  }
}

const buildTrees = (agents: Map<string, AgentRecord>, rows: AgentFigures[]): TreeFigures[] => {
  const order = [...agents.keys()]
  const rowById = new Map(rows.map((row) => [row.agentId, row]))
  const trees = new Map<string, TreeFigures>()
  for (const agentId of order) {
    const rootAgentId = rootOf(agentId, agents, order)
    const root = agents.get(rootAgentId)
    const row = rowById.get(agentId)
    if (!root || !row) continue
    const tree: TreeFigures = trees.get(rootAgentId) ?? {
      ...emptyFigure(),
      rootAgentId,
      subagentType: root.spawn.subagentType,
      issue: issueKeyOf(root.spawn.branch),
      promptTokens: 0,
      agents: 0,
    }
    trees.set(rootAgentId, tree)
    addFigure(tree, row)
    tree.promptTokens += row.input + row.cacheRead + row.cacheCreation
    tree.agents += 1
  }
  return [...trees.values()]
}

const topBashCommands = (counts: Record<string, number>): Record<string, number> =>
  Object.assign(createRecord<number>(), Object.fromEntries(Object.entries(counts).sort(([, left], [, right]) => right - left).slice(0, ROLLUP_MAX_BASH_COMMANDS)))

type ToolSummary = { tools: ToolFigures; denies: number; guards: Record<string, number>; bashCallCount: number }

const summarizeTools = (events: readonly EventRecord[], agentTypeOf: (agentId: string | null) => string): ToolSummary => {
  const tools: ToolFigures = {
    skills: createRecord(),
    mcp: createRecord(),
    commands: createRecord(),
    bash: createRecord(),
    verdicts: createRecord(),
    denyReasons: createRecord(),
    outcomes: createRecord(),
    bashPromptHook: null,
  }
  const guards = createRecord<number>()
  const seenDecisions = new Set<string>()
  const seenCalls = new Set<string>()
  const bashCalls = new Set<string>()
  let denies = 0

  for (const event of events) {
    if (event.type === 'tool.verdict') {
      const decisionKey = `${event.decision}:${event.toolUseId}`
      if (!seenDecisions.has(decisionKey)) {
        seenDecisions.add(decisionKey)
        getOrInit(tools.verdicts, agentTypeOf(event.agentId), () => ({ allow: 0, ask: 0, deny: 0 }))[event.decision] += 1
        if (event.guard !== null) bump(guards, event.guard)
        if (event.decision === 'deny') {
          denies += 1
          if (event.reason !== null) bump(tools.denyReasons, event.reason)
        }
      }
      if (!seenCalls.has(event.toolUseId)) {
        seenCalls.add(event.toolUseId)
        if (event.mcpServer !== undefined) bump(getOrInit(tools.mcp, event.mcpServer, () => createRecord<number>()), event.toolName)
        if (event.command !== undefined) bump(tools.bash, event.command.slice(0, MAX_COMMAND_CHARS))
        if (event.toolName === 'Bash') bashCalls.add(event.toolUseId)
      }
    } else if (event.type === 'skill.use' && event.kind !== 'prompted') {
      const skill = getOrInit(tools.skills, event.skill, (): SkillFigures => ({ read: 0, invoked: 0, byAgentType: createRecord() }))
      const byType = getOrInit(skill.byAgentType, agentTypeOf(event.agentId), () => ({ read: 0, invoked: 0 }))
      skill[event.kind] += 1
      byType[event.kind] += 1
    } else if (event.type === 'command.run') {
      bump(tools.commands, event.name)
    } else if (event.type === 'permission.outcome') {
      bump(tools.outcomes, event.outcome)
    }
  }

  tools.bash = topBashCommands(tools.bash)
  return { tools, denies, guards, bashCallCount: bashCalls.size }
}

const buildProfile = (events: readonly EventRecord[], agents: Map<string, AgentRecord>, guards: Record<string, number>): ProfileFigures => {
  const profile: ProfileFigures = { statusMixByType: createRecord(), reroutesByType: createRecord(), reviewPasses: 0, skillsInjected: createRecord(), guards }
  for (const event of events) {
    if (event.type !== 'agent.report') continue
    const status = event.status ?? (event.parserVersion != null ?UNKNOWN_KEY : null)
    if (status !== null) bump(getOrInit(profile.statusMixByType, event.subagentType, () => createRecord<number>()), status)
    const rule = REROUTE_RULES.get(event.subagentType)
    if (rule && event.status === rule.status && event.reportExcerpt.includes(rule.marker)) bump(profile.reroutesByType, event.subagentType)
  }
  for (const { spawn } of agents.values()) {
    if (spawn.subagentType === CODE_REVIEWER_TYPE) profile.reviewPasses += 1
    for (const skill of spawn.skillsInjected ?? []) bump(profile.skillsInjected, skill)
  }
  return profile
}

export function summarizeSession(input: SessionInput, ctx: SessionContext): SessionFigures {
  const pending = input.pendingEvents ?? []
  const liveById = new Map((input.liveAgents ?? []).map((agent) => [agent.agentId, agent]))
  const events = mergeLiveEvents(input.events, pending)
  const agents = collectAgents(events)
  const mainSnapshot = input.snapshots.find((snapshot) => snapshot.agentId === 'main')
  const snapshotById = new Map(input.snapshots.filter((snapshot) => snapshot.agentId !== 'main').map((snapshot) => [snapshot.agentId, snapshot]))
  const sessionStart = events.find((event) => event.type === 'session.start')
  const sessionEnd = events.find((event) => event.type === 'session.end')
  const agentTypeOf = (agentId: string | null): string =>
    agentId === null ? MAIN_AGENT_TYPE : (agents.get(agentId)?.spawn.subagentType ?? UNKNOWN_KEY)

  const byIssue = createRecord<Figure>()
  const byModel: SessionFigures['byModel'] = createRecord()
  const countModels = (usage: readonly UsageRecord[]): void => {
    for (const record of usage) {
      const model = getOrInit(byModel, record.model, () => ({ ...zeroTokens(), tokens: 0 }))
      addTokens(model, record)
      model.tokens += record.input + record.output + record.cacheRead + record.cacheCreation
    }
  }
  const addToIssue = (issue: string, figure: Figure): void => addFigure(getOrInit(byIssue, issue, emptyFigure), figure)

  const mainTurns = events.filter((event): event is TurnCompleteEvent => event.type === 'turn.complete' && event.agentId === null)
  const turnCostOf = (turn: TurnCompleteEvent): number => Math.max(0, turn.costUsd ?? 0)
  const turnCostSum = mainTurns.reduce((sum, turn) => sum + turnCostOf(turn), 0)
  const turnsLeadSnapshot = mainSnapshot !== undefined && turnCostSum > mainSnapshot.costUsd
  const measuredUnknownPrice = events.filter((event) => event.type === 'session.measure').at(-1)?.hasUnknownPrice === true
  const mainSource: Source =
    mainSnapshot && !turnsLeadSnapshot
      ? { usage: mainSnapshot.usage, costUsd: mainSnapshot.costUsd, hasUnknownPrice: mainSnapshot.hasUnknownPrice || measuredUnknownPrice }
      : { usage: mainTurns.map((turn) => turn.usage), costUsd: turnCostSum, hasUnknownPrice: (mainSnapshot?.hasUnknownPrice ?? false) || measuredUnknownPrice }
  const main = figureOf(mainSource)
  const mainCostGapUsd = mainSnapshot && !turnsLeadSnapshot ? Math.max(0, mainSnapshot.costUsd - turnCostSum) : 0
  countModels(mainSource.usage)
  for (const turn of mainTurns) {
    addToIssue(issueKeyOf(turn.branch), figureOf({ usage: [turn.usage], costUsd: turnCostOf(turn), hasUnknownPrice: main.hasUnknownPrice }))
  }
  addToIssue(UNATTRIBUTED_ISSUE, { ...emptyFigure(), costUsd: mainCostGapUsd })

  const total = emptyFigure()
  addFigure(total, main)
  const byType = createRecord<TypeFigures>()
  const rows: AgentFigures[] = []
  let agentsWithoutSnapshot = 0

  for (const [agentId, agent] of agents) {
    const snapshot = snapshotById.get(agentId)
    const live = agent.report === null ? liveById.get(agentId) : undefined
    if (!snapshot) agentsWithoutSnapshot += 1
    const source: Source = live
      ? { usage: live.usage, costUsd: live.costUsd ?? 0, hasUnknownPrice: live.costUsd === null }
      : snapshot
        ? { usage: snapshot.usage, costUsd: snapshot.costUsd, hasUnknownPrice: snapshot.hasUnknownPrice }
        : { usage: [], costUsd: 0, hasUnknownPrice: false }
    const figure = figureOf(source)
    const row: AgentFigures = {
      ...figure,
      agentId,
      parentAgentId: agent.spawn.parentAgentId,
      subagentType: agent.spawn.subagentType,
      engineStatus: engineStatusOf(agent.report),
      durationMs: agent.durationMs,
    }
    rows.push(row)
    addFigure(total, figure)
    countModels(source.usage)
    addToIssue(issueKeyOf(snapshot?.branch ?? agent.spawn.branch), figure)

    const type = getOrInit(byType, row.subagentType, () => ({ ...emptyFigure(), spawns: 0, durationMs: 0, engineStatusMix: {} }))
    addFigure(type, figure)
    type.spawns += 1
    type.durationMs += row.durationMs
    if (row.engineStatus !== 'running') bump(type.engineStatusMix, row.engineStatus)
  }

  const harnessProfile = sessionStart?.type === 'session.start' && sessionStart.harnessProfile === true
  const { tools, denies, guards, bashCallCount } = summarizeTools(events, agentTypeOf)
  if (harnessProfile) {
    const estimatedUsd = sessionEnd?.type === 'session.end' ? sessionEnd.estimates?.bashPromptHook.usd : undefined
    tools.bashPromptHook = { calls: bashCallCount, usd: estimatedUsd ?? null }
  }

  const isLive = pending.length > 0 || liveById.size > 0
  return {
    sessionId: events[0]?.sessionId ?? input.snapshots[0]?.sessionId ?? '',
    state: sessionEnd || !isLive ? classifySession(events, ctx.sourceMtimeMs, ctx.now) : 'open',
    harnessProfile,
    startedAt: sessionStart?.ts ?? events[0]?.ts ?? null,
    endedAt: sessionEnd?.ts ?? null,
    lastEventAt: events.length === 0 ? null : Math.max(...events.map((event) => event.ts)),
    total,
    main,
    byType,
    byModel,
    byIssue,
    trees: buildTrees(agents, rows),
    agents: rows,
    tools,
    denies,
    profile: harnessProfile ? buildProfile(events, agents, guards) : null,
    coverage: { agentsWithoutSnapshot, mainCostGapUsd, skippedNewerSchema: 0 },
  }
}
