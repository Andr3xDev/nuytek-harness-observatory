import { isRecord, tryParseJson } from '../../core/guards'
import { SUPPORTED_SCHEMA, type EventRecord } from './types'

/** Drops truncated or malformed lines and records from a newer schema; the rest keep their order. */
export function parseJsonl(lines: readonly string[]): EventRecord[] {
  const records: EventRecord[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const parsed = tryParseJson(line)
    if (isRecord(parsed) && typeof parsed.schema === 'number' && parsed.schema <= SUPPORTED_SCHEMA && typeof parsed.type === 'string' && typeof parsed.ts === 'number') {
      records.push(parsed as EventRecord)
    }
  }
  return records
}
