import { describe, expect, test } from 'claude-code/testing'
import { FLUSH_INTERVAL_MS, MAX_BATCH_BYTES, MAX_BATCH_EVENTS, MAX_BUFFERED_EVENTS } from '../capture/constants'
import { SCHEMA_VERSION, type AgentSnapshot, type ObsEvent, type PromptRecord } from '../capture/schema'
import { createBatcher, type BatchClock, type BatchSink } from './batcher'

type SinkCall = { kind: 'append' | 'upsert'; path: string; text: string }

const event = (sessionId: string, id: string): ObsEvent => ({
  schema: SCHEMA_VERSION,
  id,
  type: 'session.compact',
  ts: 1,
  sessionId,
  agentId: null,
  branch: null,
})

const snapshot = (agentId: string, tokenCount: number): AgentSnapshot => ({
  schema: SCHEMA_VERSION,
  sessionId: 's1',
  agentId,
  parentAgentId: null,
  subagentType: 'builder',
  model: 'm',
  branch: null,
  startedAt: 1,
  updatedAt: 2,
  usage: [],
  costUsd: 0,
  tokenCount,
  hasUnknownPrice: false,
  taskStatus: null,
  closed: false,
  closedReason: null,
})

const prompt: PromptRecord = {
  schema: SCHEMA_VERSION,
  promptId: 'pr-a1',
  sessionId: 's1',
  ts: 1,
  agentId: 'a1',
  subagentType: 'builder',
  sha: 'abc',
  bytes: 3,
  text: 'hey',
}

const fakeClock = () => {
  const registered: Array<{ ms: number; fn: () => void }> = []
  const clock: BatchClock = {
    every: (ms, fn) => {
      registered.push({ ms, fn })
      return () => {}
    },
  }
  return { clock, registered }
}

const recordingSink = (results: boolean[] = []) => {
  const calls: SinkCall[] = []
  const queue = [...results]
  const take = async (kind: SinkCall['kind'], path: string, text: string) => {
    calls.push({ kind, path, text })
    return queue.shift() ?? true
  }
  const sink: BatchSink = { append: (p, t) => take('append', p, t), upsert: (p, t) => take('upsert', p, t) }
  return { sink, calls }
}

const linesOf = (text: string): unknown[] =>
  text
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line))

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve()
}

describe('batcher flush', () => {
  test('one append per target and one upsert per snapshot file, each line is JSON', async () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.pushEvent(event('s1', 'e2'))
    batcher.pushEvent(event('s2', 'e3'))
    batcher.pushPrompt('2026-11-25', prompt)
    batcher.setSnapshot('a1.json', snapshot('a1', 5))
    await batcher.flush()

    const appends = calls.filter((c) => c.kind === 'append')
    expect(appends.map((c) => c.path).sort()).toEqual(['events/s1.jsonl', 'events/s2.jsonl', 'prompts-2026-11-25.jsonl'])
    const s1 = appends.find((c) => c.path === 'events/s1.jsonl')
    expect((linesOf(s1?.text ?? '') as ObsEvent[]).map((e) => e.id)).toEqual(['e1', 'e2'])
    expect(calls.filter((c) => c.kind === 'upsert')).toHaveLength(1)
  })

  test('the latest snapshot for a file wins and replaces earlier ones', async () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.setSnapshot('a1.json', snapshot('a1', 5))
    batcher.setSnapshot('a1.json', snapshot('a1', 9))
    await batcher.flush()
    const upserts = calls.filter((c) => c.kind === 'upsert')
    expect(upserts).toHaveLength(1)
    expect(upserts[0]?.path).toBe('snapshots/a1.json')
    expect((JSON.parse(upserts[0]?.text ?? '{}') as AgentSnapshot).tokenCount).toBe(9)
  })

  test('flushing with nothing queued runs nothing', async () => {
    const { sink, calls } = recordingSink()
    await createBatcher(sink, fakeClock().clock).flush()
    expect(calls).toEqual([])
  })

  test('a failed flush keeps the batch and the next flush retries it with new lines', async () => {
    const { sink, calls } = recordingSink([false])
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    await batcher.flush()
    batcher.pushEvent(event('s1', 'e2'))
    await batcher.flush()
    expect(calls).toHaveLength(2)
    expect((linesOf(calls[1]?.text ?? '') as ObsEvent[]).map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  test('a throwing sink never throws to the caller and the batch is retried', async () => {
    let attempts = 0
    const texts: string[] = []
    const sink: BatchSink = {
      append: async (_path, text) => {
        attempts++
        if (attempts === 1) throw new Error('spawn failed')
        texts.push(text)
        return true
      },
      upsert: async () => true,
    }
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    await batcher.flush()
    await batcher.flush()
    expect(texts).toHaveLength(1)
  })

  test('an awaited flush also writes entries pushed while an earlier flush was in flight', async () => {
    const writes: string[] = []
    let release: () => void = () => {}
    let first = true
    const sink: BatchSink = {
      append: async (_path, text) => {
        if (first) {
          first = false
          await new Promise<void>((resolve) => (release = resolve))
        }
        writes.push(text)
        return true
      },
      upsert: async () => true,
    }
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    void batcher.flush()
    await settle()
    batcher.pushEvent(event('s1', 'e2'))
    const awaited = batcher.flush()
    release()
    await awaited
    expect(writes.flatMap((text) => (linesOf(text) as ObsEvent[]).map((e) => e.id))).toEqual(['e1', 'e2'])
  })

  describe('awaited flush joining a run started by another caller', () => {
    const gatedSink = () => {
      const gates: Array<(ok: boolean) => void> = []
      const calls: SinkCall[] = []
      const sink: BatchSink = {
        append: (path, text) => {
          calls.push({ kind: 'append', path, text })
          return new Promise<boolean>((resolve) => gates.push(resolve))
        },
        upsert: async (path, text) => {
          calls.push({ kind: 'upsert', path, text })
          return true
        },
      }
      return { sink, gates, calls }
    }

    test('does not resolve before the append carrying its own pushed event completed', async () => {
      const { sink, gates, calls } = gatedSink()
      const batcher = createBatcher(sink, fakeClock().clock)
      batcher.pushEvent(event('s1', 'e1'))
      void batcher.flush()
      await settle()
      batcher.pushEvent(event('s1', 'end'))
      let resolved = false
      const awaited = batcher.flush(() => true).then(() => (resolved = true))
      gates[0]?.(true)
      await settle()
      expect(resolved).toBe(false)
      expect(calls).toHaveLength(2)
      gates[1]?.(true)
      await awaited
      expect(linesOf(calls[1]?.text ?? '')).toEqual([expect.objectContaining({ id: 'end' })])
    })

    test('attempts its own run once when the joined run failed, then stops', async () => {
      const { sink, gates, calls } = gatedSink()
      const batcher = createBatcher(sink, fakeClock().clock)
      batcher.pushEvent(event('s1', 'e1'))
      void batcher.flush()
      await settle()
      const awaited = batcher.flush()
      gates[0]?.(false)
      await settle()
      gates[1]?.(false)
      await awaited
      await settle()
      expect(calls).toHaveLength(2)
      expect(linesOf(calls[1]?.text ?? '')).toEqual([expect.objectContaining({ id: 'e1' })])
    })

    test('applies its own canContinue to the run it ends up executing', async () => {
      const { sink, gates, calls } = gatedSink()
      const batcher = createBatcher(sink, fakeClock().clock)
      batcher.pushEvent(event('s1', 'e1'))
      void batcher.flush()
      await settle()
      batcher.pushEvent(event('s1', 'end'))
      batcher.setSnapshot('a1.json', snapshot('a1', 1))
      const awaited = batcher.flush(() => false)
      gates[0]?.(true)
      await settle()
      gates[1]?.(true)
      await awaited
      await settle()
      expect(calls.map((c) => c.kind)).toEqual(['append', 'append'])
    })
  })

  test('a failing sink does not loop forever and size-triggered flushes pause after the failure', async () => {
    const { sink, calls } = recordingSink(Array(1000).fill(false))
    const batcher = createBatcher(sink, fakeClock().clock)
    for (let i = 0; i < MAX_BATCH_EVENTS * 3; i++) batcher.pushEvent(event('s1', `e${i}`))
    await settle()
    await batcher.flush()
    expect(calls.length).toBeLessThanOrEqual(3)
  })

  test('snapshots stay queued when canContinue is false and events are still appended', async () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.setSnapshot('a1.json', snapshot('a1', 1))
    await batcher.flush(() => false)
    expect(calls.map((c) => c.kind)).toEqual(['append'])
    await batcher.flush()
    expect(calls.map((c) => c.kind)).toEqual(['append', 'upsert'])
  })

  test('reaching the batch event cap triggers a flush without an explicit call', async () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    for (let i = 0; i < MAX_BATCH_EVENTS; i++) batcher.pushEvent(event('s1', `e${i}`))
    await settle()
    expect(calls).toHaveLength(1)
  })

  test('reaching the batch byte cap triggers a flush without an explicit call', async () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushPrompt('2026-11-25', { ...prompt, text: 'x'.repeat(MAX_BATCH_BYTES) })
    await settle()
    expect(calls).toHaveLength(1)
  })

  test('above the buffer cap the oldest events are dropped and counted', async () => {
    const { sink, calls } = recordingSink(Array(50).fill(false))
    const batcher = createBatcher(sink, fakeClock().clock)
    const extra = 5
    for (let i = 0; i < MAX_BUFFERED_EVENTS + extra; i++) batcher.pushEvent(event('s1', `e${i}`))
    await settle()
    expect(batcher.droppedEvents).toBe(extra)
    const pending = batcher.pendingEvents('s1')
    expect(pending).toHaveLength(MAX_BUFFERED_EVENTS)
    expect(pending[0]?.id).toBe(`e${extra}`)
    expect(calls.length).toBeGreaterThan(0)
  })
})

describe('batcher timer', () => {
  test('starts lazily at the first push, once, and the tick flushes', async () => {
    const { sink, calls } = recordingSink()
    const { clock, registered } = fakeClock()
    const batcher = createBatcher(sink, clock)
    expect(registered).toHaveLength(0)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.pushEvent(event('s1', 'e2'))
    expect(registered.map((r) => r.ms)).toEqual([FLUSH_INTERVAL_MS])
    registered[0]?.fn()
    await settle()
    expect(calls).toHaveLength(1)
  })

  test('a throwing clock drops no event and the timer is retried on the next push', () => {
    let attempts = 0
    const clock: BatchClock = {
      every: () => {
        attempts++
        if (attempts === 1) throw new Error('clock down')
        return () => {}
      },
    }
    const batcher = createBatcher(recordingSink().sink, clock)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.pushEvent(event('s1', 'e2'))
    expect(attempts).toBe(2)
    expect(batcher.pendingEvents('s1').map((e) => e.id)).toEqual(['e1', 'e2'])
  })
})

describe('pendingEvents', () => {
  test('returns queued events of the requested session only, in append order', () => {
    const batcher = createBatcher(recordingSink().sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.pushEvent(event('s2', 'x1'))
    batcher.pushEvent(event('s1', 'e2'))
    batcher.pushPrompt('2026-11-25', prompt)
    batcher.setSnapshot('a1.json', snapshot('a1', 1))
    expect(batcher.pendingEvents('s1').map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  test('result and records are frozen and mutating them leaves the batcher unchanged', () => {
    const batcher = createBatcher(recordingSink().sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    const result = batcher.pendingEvents('s1')
    expect(Object.isFrozen(result)).toBe(true)
    expect(Object.isFrozen(result[0])).toBe(true)
    try {
      ;(result[0] as { id: string }).id = 'changed'
    } catch {
      // frozen objects throw in strict mode
    }
    expect(batcher.pendingEvents('s1')[0]?.id).toBe('e1')
  })

  test('never runs the sink', () => {
    const { sink, calls } = recordingSink()
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    batcher.pendingEvents('s1')
    expect(calls).toEqual([])
  })

  test('events stay visible while a flush is in flight and are gone after it succeeds', async () => {
    let release: (ok: boolean) => void = () => {}
    let appends = 0
    const sink: BatchSink = {
      // Only the first append is held; flush drains e2 with a second append that succeeds at once.
      append: () => (appends++ === 0 ? new Promise<boolean>((resolve) => (release = resolve)) : Promise.resolve(true)),
      upsert: async () => true,
    }
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    const flushing = batcher.flush()
    await settle()
    batcher.pushEvent(event('s1', 'e2'))
    expect(batcher.pendingEvents('s1').map((e) => e.id)).toEqual(['e1', 'e2'])
    release(true)
    await flushing
    expect(appends).toBe(2)
    expect(batcher.pendingEvents('s1')).toEqual([])
  })

  test('events return to the queue and stay visible after a failed flush', async () => {
    const { sink } = recordingSink([false])
    const batcher = createBatcher(sink, fakeClock().clock)
    batcher.pushEvent(event('s1', 'e1'))
    await batcher.flush()
    expect(batcher.pendingEvents('s1').map((e) => e.id)).toEqual(['e1'])
  })
})
