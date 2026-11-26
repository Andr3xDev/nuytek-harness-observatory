import type { AgentSnapshot } from './schema'

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Only the fields readers rely on; a file from an older or damaged write fails the guard instead of throwing later. */
export const isSnapshotShape = (value: unknown): value is AgentSnapshot =>
  isRecord(value) && typeof value.sessionId === 'string' && typeof value.closed === 'boolean'
