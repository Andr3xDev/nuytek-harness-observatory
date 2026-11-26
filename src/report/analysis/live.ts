import type { EventRecord } from './types'

/** Dedupes by id over stored then pending: an ambiguous append failure can be retried and store a batch twice. */
export function mergeLiveEvents(stored: readonly EventRecord[], pending: readonly EventRecord[]): EventRecord[] {
  const seenIds = new Set<string>()
  return [...stored, ...pending].filter((event) => {
    if (seenIds.has(event.id)) return false
    seenIds.add(event.id)
    return true
  })
}
