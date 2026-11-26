import { emptyFigure } from '../../core/figures'
import { cacheRatio } from './issue'
import { createRecord } from './session'
import type { AggregateFigures, Figure, ProfileFigures, SessionFigures, SkillFigures, TokenCounts, ToolFigures, TypeFigures } from './types'

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
    addCounts(tools.bash, part.bash)
    addCounts(tools.denyReasons, part.denyReasons)
    addCounts(tools.outcomes, part.outcomes)
    for (const [type, verdicts] of Object.entries(part.verdicts)) {
      const merged = getOrInit(tools.verdicts, type, () => ({ allow: 0, ask: 0, deny: 0 }))
      merged.allow += verdicts.allow
      merged.ask += verdicts.ask
      merged.deny += verdicts.deny
    }
    if (part.bashPromptHook !== null) {
      const hook = (tools.bashPromptHook ??= { calls: 0, usd: null })
      hook.calls += part.bashPromptHook.calls
      if (part.bashPromptHook.usd !== null) hook.usd = (hook.usd ?? 0) + part.bashPromptHook.usd
    }
  }
  return tools
}

const mergeProfile = (sessions: readonly SessionFigures[]): AggregateFigures['profile'] => {
  const profiled = sessions.flatMap((session) => (session.harnessProfile && session.profile !== null ? [session.profile] : []))
  if (profiled.length === 0) return null
  const merged: ProfileFigures = { statusMixByType: createRecord(), reroutesByType: createRecord(), reviewPasses: 0, skillsInjected: createRecord(), guards: createRecord() }
  for (const profile of profiled) {
    addNested(merged.statusMixByType, profile.statusMixByType)
    addCounts(merged.reroutesByType, profile.reroutesByType)
    merged.reviewPasses += profile.reviewPasses
    addCounts(merged.skillsInjected, profile.skillsInjected)
    addCounts(merged.guards, profile.guards)
  }
  return { ...merged, coverage: { profileSessions: profiled.length, sessions: sessions.length } }
}

const ratio = (part: number, whole: number): number | null => (whole === 0 ? null : part / whole)

const byDescending = <T>(rows: T[], valueOf: (row: T) => number, nameOf: (row: T) => string): T[] =>
  rows.sort((left, right) => valueOf(right) - valueOf(left) || nameOf(left).localeCompare(nameOf(right)))

export function combineSessions(sessions: readonly SessionFigures[]): AggregateFigures {
  const total = emptyFigure()
  const types = createRecord<TypeFigures>()
  const models = createRecord<TokenCounts & { tokens: number }>()
  const typeModels = new Map<string, AggregateFigures['byTypeModel'][number]>()
  const issues = createRecord<Figure>()
  const engineStatusMix = createRecord<number>()
  let denies = 0

  for (const session of sessions) {
    addFigure(total, session.total)
    denies += session.denies
    for (const [type, figures] of Object.entries(session.byType)) {
      const merged = getOrInit(types, type, () => ({ ...emptyFigure(), spawns: 0, durationMs: 0, engineStatusMix: createRecord<number>() }))
      addFigure(merged, figures)
      merged.spawns += figures.spawns
      merged.durationMs += figures.durationMs
      addCounts(merged.engineStatusMix, figures.engineStatusMix)
      addCounts(engineStatusMix, figures.engineStatusMix)
    }
    for (const [model, figures] of Object.entries(session.byModel)) {
      const merged = getOrInit(models, model, () => ({ input: 0, output: 0, cacheRead: 0, cacheCreation: 0, tokens: 0 }))
      merged.input += figures.input
      merged.output += figures.output
      merged.cacheRead += figures.cacheRead
      merged.cacheCreation += figures.cacheCreation
      merged.tokens += figures.tokens
    }
    for (const [issue, figures] of Object.entries(session.byIssue)) addFigure(getOrInit(issues, issue, emptyFigure), figures)
    for (const agent of session.agents) {
      const model = agent.model ?? null
      const key = JSON.stringify([agent.subagentType, model])
      const merged = typeModels.get(key) ?? { ...emptyFigure(), type: agent.subagentType, model, spawns: 0 }
      typeModels.set(key, merged)
      addFigure(merged, agent)
      merged.spawns += 1
    }
  }

  const totalSpawns = Object.values(types).reduce((sum, type) => sum + type.spawns, 0)
  const startedAt = sessions.flatMap((session) => (session.startedAt === null ? [] : [session.startedAt]))
  const lastEventAt = sessions.flatMap((session) => session.lastEventAt ?? session.endedAt ?? [])

  return {
    sessions: sessions.length,
    openSessions: sessions.filter((session) => session.state === 'open').length,
    windowStart: startedAt.length === 0 ? null : Math.min(...startedAt),
    windowEnd: lastEventAt.length === 0 ? null : Math.max(...lastEventAt),
    total,
    cacheRatio: cacheRatio(total),
    byType: byDescending(
      Object.entries(types).map(([type, figures]) => ({
        ...figures,
        type,
        spawnShare: ratio(figures.spawns, totalSpawns),
        tokenShare: ratio(figures.tokens, total.tokens),
        avgTokens: ratio(figures.tokens, figures.spawns),
        avgDurationMs: ratio(figures.durationMs, figures.spawns),
        cacheRatio: cacheRatio(figures),
      })),
      (row) => row.tokens,
      (row) => row.type,
    ),
    byTypeModel: byDescending(
      [...typeModels.values()],
      (row) => row.tokens,
      (row) => `${row.type} ${row.model ?? ''}`,
    ),
    byModel: byDescending(
      Object.entries(models).map(([model, figures]) => ({ model, ...figures })),
      (row) => row.tokens,
      (row) => row.model,
    ),
    byIssue: byDescending(
      Object.entries(issues)
        .filter(([, figures]) => figures.tokens > 0 || figures.costUsd > 0)
        .map(([issue, figures]) => ({ issue, ...figures })),
      (row) => row.costUsd,
      (row) => row.issue,
    ),
    engineStatusMix,
    denies,
    tools: mergeTools(sessions),
    profile: mergeProfile(sessions),
  }
}
