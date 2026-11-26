import { SUPPORTED_SCHEMA, type EventRecord, type ParseResult } from './types'

export function parseJsonl(lines: readonly string[]): ParseResult {
  const result: ParseResult = { records: [], skippedNewerSchema: 0, skippedMalformed: 0 }
  for (const line of lines) {
    if (line.trim() === '') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      result.skippedMalformed += 1
      continue
    }
    const schema = typeof parsed === 'object' && parsed !== null ? (parsed as { schema?: unknown }).schema : undefined
    if (typeof schema !== 'number') {
      result.skippedMalformed += 1
    } else if (schema > SUPPORTED_SCHEMA) {
      result.skippedNewerSchema += 1
    } else {
      result.records.push(parsed as EventRecord)
    }
  }
  return result
}
