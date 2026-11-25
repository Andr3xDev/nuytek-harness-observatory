import type { EventRecord } from './types'

export function mergeLiveEvents(stored: readonly EventRecord[], pending: readonly EventRecord[]): EventRecord[] {
  const seenIds = new Set(stored.map((event) => event.id))
  const unflushed = pending.filter((event) => {
    if (seenIds.has(event.id)) return false
    seenIds.add(event.id)
    return true
  })
  return [...stored, ...unflushed]
}
