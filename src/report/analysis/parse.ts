import { isRecord, tryParseJson } from '../../core/guards'
import type { ObsEvent } from '../../core/schema'
import { SUPPORTED_SCHEMA } from './types'

/** Drops truncated or malformed lines and records from a newer schema; the rest keep their order. */
export function parseJsonl(lines: readonly string[]): ObsEvent[] {
  const records: ObsEvent[] = []
  for (const line of lines) {
    if (line.trim() === '') continue
    const parsed = tryParseJson(line)
    if (isRecord(parsed) && typeof parsed.schema === 'number' && parsed.schema <= SUPPORTED_SCHEMA && typeof parsed.type === 'string' && typeof parsed.ts === 'number') {
      records.push(parsed as ObsEvent)
    }
  }
  return records
}
