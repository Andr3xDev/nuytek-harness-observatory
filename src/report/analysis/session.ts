import { addFigure, addTokens, createRecord, emptyFigure, getOrInit, zeroTokens } from '../../core/figures'
import type { AgentReportEvent, AgentSpawnEvent, TurnCompleteEvent, UsageRecord } from '../../core/schema'
import { mergeLiveEvents } from './live'
import { modelOf } from './model'
import {
  OPEN_SESSION_MAX_IDLE_MS,
  type AgentFigures,
  type EventRecord,
  type Figure,
  type ProfileFigures,
  type SessionContext,
  type SessionFigures,
  type SessionInput,
  type SessionState,
  type SkillFigures,
  type ToolFigures,
  type TypeFigures,
} from './types'

const MAIN_AGENT_TYPE = 'main'
const UNKNOWN_KEY = 'unknown'
/** Float noise below this must not flip the main figure from the snapshot to turn usage. */
const COST_EPSILON_USD = 1e-9
const FINAL_ENGINE_STATUSES = ['completed', 'failed', 'stopped']

type AgentRecord = { spawn: AgentSpawnEvent; report: AgentReportEvent | null }
type Source = { usage: readonly UsageRecord[]; costUsd: number; hasUnknownPrice: boolean }

const figureOf = ({ usage, costUsd, hasUnknownPrice }: Source): Figure => {
  const figure: Figure = { ...emptyFigure(), costUsd, hasUnknownPrice }
  for (const record of usage) addTokens(figure, record)
  figure.tokens = figure.input + figure.output + figure.cacheRead + figure.cacheCreation
  return figure
}

const bump = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1
}

/** A resumed session appends a new session.start after its earlier session.end, so only a trailing end closes it. */
const lifecycleEnd = (events: readonly EventRecord[]): EventRecord | undefined => {
  const last = events.filter((event) => event.type === 'session.start' || event.type === 'session.end').at(-1)
  return last?.type === 'session.end' ? last : undefined
}

export function classifySession(events: EventRecord[], sourceMtimeMs: number, now: number): SessionState {
  if (lifecycleEnd(events)) return 'closed'
  return now - sourceMtimeMs <= OPEN_SESSION_MAX_IDLE_MS ? 'open' : 'stale'
}

const collectAgents = (events: readonly EventRecord[]): Map<string, AgentRecord> => {
  const agents = new Map<string, AgentRecord>()
  for (const event of events) {
    if (event.type === 'agent.spawn' && event.agentId !== null && !agents.has(event.agentId)) {
      agents.set(event.agentId, { spawn: event, report: null })
    }
  }
  for (const event of events) {
    const agent = event.agentId === null ? undefined : agents.get(event.agentId)
    if (agent && event.type === 'agent.report') agent.report = event
  }
  return agents
}

const engineStatusOf = (report: AgentReportEvent | null): AgentFigures['engineStatus'] => {
  if (!report) return 'running'
  const status = report.engineStatus
  return status !== null && FINAL_ENGINE_STATUSES.includes(status) ? (status as AgentFigures['engineStatus']) : 'unknown'
}

const summarizeTools = (events: readonly EventRecord[], agentTypeOf: (agentId: string | null) => string): ToolFigures => {
  const tools: ToolFigures = { skills: createRecord(), mcp: createRecord(), commands: createRecord() }
  const seenCalls = new Set<string>()

  for (const event of events) {
    if (event.type === 'tool.verdict') {
      if (!seenCalls.has(event.toolUseId)) {
        seenCalls.add(event.toolUseId)
        if (event.mcpServer !== undefined) bump(getOrInit(tools.mcp, event.mcpServer, () => createRecord<number>()), event.toolName)
      }
    } else if (event.type === 'skill.use') {
      const skill = getOrInit(tools.skills, event.skill, (): SkillFigures => ({ prompted: 0, read: 0, invoked: 0, byAgentType: createRecord() }))
      const byType = getOrInit(skill.byAgentType, agentTypeOf(event.agentId), () => ({ prompted: 0, read: 0, invoked: 0 }))
      skill[event.kind] += 1
      byType[event.kind] += 1
    } else if (event.type === 'command.run') {
      bump(tools.commands, event.name)
    }
  }

  return tools
}

const buildProfile = (agents: Map<string, AgentRecord>): ProfileFigures => {
  const profile: ProfileFigures = { skillsInjected: createRecord() }
  for (const { spawn } of agents.values()) {
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
  const sessionEnd = lifecycleEnd(events)
  const agentTypeOf = (agentId: string | null): string =>
    agentId === null ? MAIN_AGENT_TYPE : (agents.get(agentId)?.spawn.subagentType ?? UNKNOWN_KEY)

  const byModel: SessionFigures['byModel'] = createRecord()
  const countModels = (usage: readonly UsageRecord[]): void => {
    for (const record of usage) {
      const model = getOrInit(byModel, record.model, () => ({ ...zeroTokens(), tokens: 0 }))
      addTokens(model, record)
      model.tokens += record.input + record.output + record.cacheRead + record.cacheCreation
    }
  }

  const mainTurns = events.filter((event): event is TurnCompleteEvent => event.type === 'turn.complete' && event.agentId === null)
  const turnCostOf = (turn: TurnCompleteEvent): number => Math.max(0, turn.costUsd ?? 0)
  const turnCostSum = mainTurns.reduce((sum, turn) => sum + turnCostOf(turn), 0)
  const turnsLeadSnapshot = mainSnapshot !== undefined && turnCostSum - mainSnapshot.costUsd > COST_EPSILON_USD
  const measuredUnknownPrice = events.filter((event) => event.type === 'session.measure').at(-1)?.hasUnknownPrice === true
  const mainSource: Source =
    mainSnapshot && !turnsLeadSnapshot
      ? { usage: mainSnapshot.usage, costUsd: mainSnapshot.costUsd, hasUnknownPrice: mainSnapshot.hasUnknownPrice || measuredUnknownPrice }
      : { usage: mainTurns.map((turn) => turn.usage), costUsd: turnCostSum, hasUnknownPrice: (mainSnapshot?.hasUnknownPrice ?? false) || measuredUnknownPrice }
  const main = figureOf(mainSource)
  countModels(mainSource.usage)

  const total = emptyFigure()
  addFigure(total, main)
  const byType = createRecord<TypeFigures>()
  const rows: AgentFigures[] = []

  for (const [agentId, agent] of agents) {
    const snapshot = snapshotById.get(agentId)
    const live = agent.report === null ? liveById.get(agentId) : undefined
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
      model: modelOf(source.usage, snapshot?.model),
      effort: snapshot?.effort ?? null,
      startedAt: agent.spawn.ts,
      engineStatus: engineStatusOf(agent.report),
    }
    rows.push(row)
    addFigure(total, figure)
    countModels(source.usage)

    const type = getOrInit(byType, row.subagentType, () => ({ ...emptyFigure(), spawns: 0 }))
    addFigure(type, figure)
    type.spawns += 1
  }

  const harnessProfile = sessionStart?.type === 'session.start' && sessionStart.harnessProfile === true

  const isLive = pending.length > 0 || liveById.size > 0
  return {
    sessionId: events[0]?.sessionId ?? input.snapshots[0]?.sessionId ?? '',
    state: sessionEnd || !isLive ? classifySession(events, ctx.sourceMtimeMs, ctx.now) : 'open',
    harnessProfile,
    startedAt: sessionStart?.ts ?? events[0]?.ts ?? null,
    endedAt: sessionEnd?.ts ?? null,
    lastEventAt: events.length === 0 ? null : events.reduce((latest, event) => Math.max(latest, event.ts), -Infinity),
    total,
    main,
    mainModel: modelOf(mainSource.usage, mainSnapshot?.model),
    byType,
    byModel,
    agents: rows,
    tools: summarizeTools(events, agentTypeOf),
    profile: harnessProfile ? buildProfile(agents) : null,
  }
}
