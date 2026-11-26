import type { AgentSnapshot } from './schema'

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** `undefined` for text that is not JSON, so callers treat a damaged file like a missing one. */
export const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/** Only the fields readers rely on; a file from an older or damaged write fails the guard instead of throwing later. */
export const isSnapshotShape = (value: unknown): value is AgentSnapshot =>
  isRecord(value) &&
  typeof value.sessionId === 'string' &&
  typeof value.agentId === 'string' &&
  typeof value.closed === 'boolean' &&
  typeof value.costUsd === 'number' &&
  Number.isFinite(value.costUsd) &&
  typeof value.hasUnknownPrice === 'boolean' &&
  Array.isArray(value.usage)
