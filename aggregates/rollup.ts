import { SUPPORTED_SCHEMA, type SessionFigures, type SessionRollup, type SourceListing, type SourceStat } from './types'

// 2: skill figures gained `prompted`; version 1 rollups lack it.
export const ROLLUP_VERSION = 3

export const eventsPathOf = (sessionId: string): string => `events/${sessionId}.jsonl`
export const mainSnapshotPathOf = (sessionId: string): string => `snapshots/main-${sessionId}.json`
export const agentSnapshotPathOf = (agentId: string): string => `snapshots/${agentId}.json`

export function buildRollup(figures: SessionFigures, listing: SourceListing, builtAt: number): SessionRollup {
  const candidates = [eventsPathOf(figures.sessionId), mainSnapshotPathOf(figures.sessionId), ...figures.agents.map((agent) => agentSnapshotPathOf(agent.agentId))]
  const sources = [...new Set(candidates)].flatMap((path) => {
    const stat = Object.hasOwn(listing, path) ? listing[path] : undefined
    return stat ? [{ path, size: stat.size, mtimeMs: stat.mtimeMs }] : []
  })
  return { rollupVersion: ROLLUP_VERSION, schemaVersions: [SUPPORTED_SCHEMA], sessionId: figures.sessionId, state: figures.state, sources, builtAt, figures }
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const sameStat = (source: unknown, current: SourceStat | undefined): boolean =>
  isRecord(source) && current !== undefined && source.size === current.size && source.mtimeMs === current.mtimeMs

export function isRollupFresh(rollup: unknown, listing: SourceListing): rollup is SessionRollup {
  if (!isRecord(rollup) || rollup.rollupVersion !== ROLLUP_VERSION) return false
  const { schemaVersions, sessionId, state, sources, figures } = rollup
  if (!Array.isArray(schemaVersions) || !schemaVersions.every((version) => typeof version === 'number' && version <= SUPPORTED_SCHEMA)) return false
  if (typeof sessionId !== 'string' || (state !== 'closed' && state !== 'stale') || !isRecord(figures)) return false
  if (!Array.isArray(sources) || !sources.some((source) => isRecord(source) && source.path === eventsPathOf(sessionId))) return false
  return sources.every((source) => isRecord(source) && typeof source.path === 'string' && Object.hasOwn(listing, source.path) && sameStat(source, listing[source.path]))
}
