import type { ObsEvent } from '../../core/schema'

/** Dedupes by id over stored then pending: an ambiguous append failure can be retried and store a batch twice. */
export function mergeLiveEvents(stored: readonly ObsEvent[], pending: readonly ObsEvent[]): ObsEvent[] {
  const seenIds = new Set<string>()
  return [...stored, ...pending].filter((event) => {
    if (seenIds.has(event.id)) return false
    seenIds.add(event.id)
    return true
  })
}
