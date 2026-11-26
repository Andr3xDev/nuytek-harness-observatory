import { FLUSH_INTERVAL_MS, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, MAX_BUFFERED_EVENTS } from '../capture/constants'
import type { AgentSnapshot, ObsEvent, PromptRecord } from '../capture/schema'

export type BatchSink = {
  append: (path: string, text: string) => Promise<boolean>
  upsert: (path: string, text: string) => Promise<boolean>
}

export type BatchClock = { every: (ms: number, fn: () => void) => () => void }

type Entry = { path: string; line: string; event?: ObsEvent }

export type Batcher = {
  pushEvent: (event: ObsEvent) => void
  pushPrompt: (date: string, record: PromptRecord) => void
  /** `file` is the snapshot file name, for example `a1.json`; the latest call per file wins. */
  setSnapshot: (file: string, snapshot: AgentSnapshot) => void
  /**
   * Writes everything queued, including entries pushed while a write was in flight, and stops after a
   * run that failed. Event appends always run; `canContinue` is asked before each snapshot upsert and a
   * `false` leaves the remaining snapshots queued.
   */
  flush: (canContinue?: () => boolean) => Promise<void>
  /** Queued and in-flight events of one session, frozen, in append order. */
  pendingEvents: (sessionId: string) => readonly ObsEvent[]
  readonly droppedEvents: number
}

const SNAPSHOT_DIR = 'snapshots'
const encoder = new TextEncoder()

export const createBatcher = (sink: BatchSink, clock: BatchClock): Batcher => {
  let queue: Entry[] = []
  let inflight: Entry[] = []
  let snapshots = new Map<string, string>()
  let droppedEvents = 0
  let stopTimer: (() => void) | undefined
  let flushing: Promise<void> | undefined
  // The last run left work unwritten; size-triggered flushes pause until the timer or an explicit flush.
  let stalled = false
  // A run may be started by another waiting caller, so every waiter's budget applies to it.
  const waiterGuards: Array<() => boolean> = []

  const dropOldestAboveCap = (): void => {
    const excess = queue.length - MAX_BUFFERED_EVENTS
    if (excess <= 0) return
    queue = queue.slice(excess)
    droppedEvents += excess
  }

  const queuedBytes = (): number => queue.reduce((sum, entry) => sum + encoder.encode(entry.line).length, 0)

  const startTimerOnce = (): void => {
    if (stopTimer) return
    try {
      stopTimer = clock.every(FLUSH_INTERVAL_MS, () => void flush())
    } catch {
      // Retried on the next push; the entry is already queued.
    }
  }

  const enqueue = (entry: Entry): void => {
    queue.push(entry)
    startTimerOnce()
    dropOldestAboveCap()
    // A run in flight already loops until the queue is drained, so a joining flush per push would only multiply retries.
    if (!stalled && !flushing && (queue.length >= MAX_BATCH_EVENTS || queuedBytes() >= MAX_BATCH_BYTES)) void flush()
  }

  const attempt = async (send: () => Promise<boolean>): Promise<boolean> => {
    try {
      return await send()
    } catch {
      return false
    }
  }

  const run = async (): Promise<void> => {
    stalled = false
    const batch = queue
    const dirtySnapshots = snapshots
    queue = []
    snapshots = new Map()
    inflight = batch

    const byPath = new Map<string, Entry[]>()
    for (const entry of batch) byPath.set(entry.path, [...(byPath.get(entry.path) ?? []), entry])
    const failedEntries: Entry[] = []
    for (const [path, entries] of byPath) {
      const ok = await attempt(() => sink.append(path, entries.map((entry) => entry.line).join('')))
      if (!ok) {
        failedEntries.push(...entries)
        stalled = true
      }
    }
    for (const [file, text] of dirtySnapshots) {
      const ok = waiterGuards.every((canContinue) => canContinue()) && (await attempt(() => sink.upsert(`${SNAPSHOT_DIR}/${file}`, text)))
      if (!ok) {
        stalled = true
        if (!snapshots.has(file)) snapshots.set(file, text)
      }
    }

    inflight = []
    queue = [...failedEntries, ...queue]
    dropOldestAboveCap()
  }

  const flush = async (canContinue: () => boolean = () => true): Promise<void> => {
    let ranOwn = false
    waiterGuards.push(canContinue)
    try {
      for (;;) {
        if (flushing) {
          await flushing
          // Another caller's run may have resumed first and started a new one: re-check before returning.
          continue
        }
        if (queue.length === 0 && snapshots.size === 0) return
        // A stall only ends the loop after this caller's own attempt, so a joined failed run never skips it.
        if (ranOwn && stalled) return
        ranOwn = true
        flushing = run().finally(() => {
          flushing = undefined
        })
        await flushing
      }
    } finally {
      waiterGuards.splice(waiterGuards.indexOf(canContinue), 1)
    }
  }

  return {
    flush,
    get droppedEvents() {
      return droppedEvents
    },
    pushEvent: (event) => {
      Object.freeze(event)
      enqueue({ path: `events/${event.sessionId}.jsonl`, line: `${JSON.stringify(event)}\n`, event })
    },
    pushPrompt: (date, record) => enqueue({ path: `prompts-${date}.jsonl`, line: `${JSON.stringify(record)}\n` }),
    setSnapshot: (file, snapshot) => {
      startTimerOnce()
      snapshots.set(file, JSON.stringify(snapshot))
    },
    pendingEvents: (sessionId) =>
      Object.freeze(
        [...inflight, ...queue].flatMap((entry) => (entry.event?.sessionId === sessionId ? [entry.event] : [])),
      ),
  }
}
