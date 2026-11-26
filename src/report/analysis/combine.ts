import { RECENT_AGENTS_CAP } from '../../core/constants'
import { emptyFigure } from '../../core/figures'
import { createRecord } from './session'
import type { AggregateFigures, Figure, ProfileFigures, RecentAgent, SessionFigures, SkillFigures, TokenCounts, ToolFigures, TypeFigures } from './types'

type Counts = Record<string, number>

const addFigure = (target: Figure, part: Figure): void => {
  target.input += part.input
  target.output += part.output
  target.cacheRead += part.cacheRead
  target.cacheCreation += part.cacheCreation
  target.tokens += part.tokens
  target.costUsd += part.costUsd
  target.hasUnknownPrice ||= part.hasUnknownPrice
}

const getOrInit = <T>(record: Record<string, T>, key: string, make: () => T): T => (record[key] ??= make())

const addCounts = (target: Counts, part: Counts): void => {
  for (const [key, count] of Object.entries(part)) target[key] = (target[key] ?? 0) + count
}

const addNested = (target: Record<string, Counts>, part: Record<string, Counts>): void => {
  for (const [key, counts] of Object.entries(part)) addCounts(getOrInit(target, key, createRecord<number>), counts)
}

const mergeTools = (sessions: readonly SessionFigures[]): ToolFigures => {
  const tools: ToolFigures = { skills: createRecord(), mcp: createRecord(), commands: createRecord() }
  for (const { tools: part } of sessions) {
    for (const [name, skill] of Object.entries(part.skills)) {
      const merged = getOrInit(tools.skills, name, (): SkillFigures => ({ prompted: 0, read: 0, invoked: 0, byAgentType: createRecord() }))
      merged.prompted += skill.prompted
      merged.read += skill.read
      merged.invoked += skill.invoked
      for (const [type, figures] of Object.entries(skill.byAgentType)) {
        const byType = getOrInit(merged.byAgentType, type, () => ({ prompted: 0, read: 0, invoked: 0 }))
        byType.prompted += figures.prompted
        byType.read += figures.read
        byType.invoked += figures.invoked
      }
    }
    addNested(tools.mcp, part.mcp)
    addCounts(tools.commands, part.commands)
  }
  return tools
}

const mergeProfile = (sessions: readonly SessionFigures[]): AggregateFigures['profile'] => {
  const profiled = sessions.flatMap((session) => (session.harnessProfile && session.profile !== null ? [session.profile] : []))
  if (profiled.length === 0) return null
  const merged: ProfileFigures = { skillsInjected: createRecord() }
  for (const profile of profiled) addCounts(merged.skillsInjected, profile.skillsInjected)
  return merged
}

const byDescending = <T>(rows: T[], valueOf: (row: T) => number, nameOf: (row: T) => string): T[] =>
  rows.sort((left, right) => valueOf(right) - valueOf(left) || nameOf(left).localeCompare(nameOf(right)))

export function combineSessions(sessions: readonly SessionFigures[]): AggregateFigures {
  const total = emptyFigure()
  const types = createRecord<TypeFigures>()
  const models = createRecord<TokenCounts & { tokens: number }>()
  const typeModels = new Map<string, AggregateFigures['byTypeModelEffort'][number]>()
  const recent: RecentAgent[] = []

  for (const session of sessions) {
    addFigure(total, session.total)
    for (const [type, figures] of Object.entries(session.byType)) {
      const merged = getOrInit(types, type, () => ({ ...emptyFigure(), spawns: 0 }))
      addFigure(merged, figures)
      merged.spawns += figures.spawns
    }
    for (const [model, figures] of Object.entries(session.byModel)) {
      const merged = getOrInit(models, model, () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, tokens: 0 }))
      merged.input += figures.input
      merged.output += figures.output
      merged.cacheRead += figures.cacheRead
      merged.cacheCreation += figures.cacheCreation
      merged.tokens += figures.tokens
    }
    for (const agent of session.agents) {
      const model = agent.model ?? null
      const effort = agent.effort ?? null
      const key = JSON.stringify([agent.subagentType, model, effort])
      const merged = typeModels.get(key) ?? { ...emptyFigure(), type: agent.subagentType, model, effort, spawns: 0 }
      typeModels.set(key, merged)
      addFigure(merged, agent)
      merged.spawns += 1
      if (agent.startedAt !== undefined) {
        recent.push({
          sessionId: session.sessionId,
          agentId: agent.agentId,
          type: agent.subagentType,
          model,
          effort,
          startedAt: agent.startedAt,
          input: agent.input,
          output: agent.output,
          cacheRead: agent.cacheRead,
          cacheCreation: agent.cacheCreation,
          tokens: agent.tokens,
          costUsd: agent.costUsd,
          hasUnknownPrice: agent.hasUnknownPrice,
        })
      }
    }
  }
  recent.sort((left, right) => right.startedAt - left.startedAt)

  const startedAt = sessions.flatMap((session) => (session.startedAt === null ? [] : [session.startedAt]))
  const lastEventAt = sessions.flatMap((session) => session.lastEventAt ?? session.endedAt ?? [])

  return {
    sessions: sessions.length,
    windowStart: startedAt.length === 0 ? null : Math.min(...startedAt),
    windowEnd: lastEventAt.length === 0 ? null : Math.max(...lastEventAt),
    total,
    byType: byDescending(
      Object.entries(types).map(([type, figures]) => ({ ...figures, type })),
      (row) => row.tokens,
      (row) => row.type,
    ),
    byTypeModelEffort: byDescending(
      [...typeModels.values()],
      (row) => row.tokens,
      (row) => `${row.type} ${row.model ?? ''} ${row.effort ?? ''}`,
    ),
    recentAgents: recent.slice(0, RECENT_AGENTS_CAP),
    byModel: byDescending(
      Object.entries(models).map(([model, figures]) => ({ model, ...figures })),
      (row) => row.tokens,
      (row) => row.model,
    ),
    tools: mergeTools(sessions),
    profile: mergeProfile(sessions),
  }
}
