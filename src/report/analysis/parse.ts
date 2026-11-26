import { isRecord } from '../../core/guards'
import { SUPPORTED_SCHEMA, type EventRecord } from './types'

/** Drops truncated or malformed lines and records from a newer schema; the rest keep their order. */
export function parseJsonl(lines: readonly string[]): EventRecord[] {
  const records: EventRecord[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      continue
    }
    const schema = isRecord(parsed) ? (parsed as { schema?: unknown }).schema : undefined
    if (typeof schema === 'number' && schema <= SUPPORTED_SCHEMA) records.push(parsed as EventRecord)
  }
  return records
}
