import { describe, expect, test } from 'claude-code/testing'
import { listSources, readLines } from './reader'
import { createFakeFs } from './test-fs'

const ENCODER = new TextEncoder()
const sizeOf = (text: string): number => ENCODER.encode(text).length
const FILE = 'events/s1.jsonl'

const linesOf = async (content: string, chunkBytes?: number) => {
  const { fs } = createFakeFs({ [FILE]: { content } })
  return readLines(fs, FILE, sizeOf(content), chunkBytes)
}

describe('listSources', () => {
  test('lists events and snapshots with size and mtime keyed by relative path', async () => {
    const fake = createFakeFs({
      'events/s1.jsonl': { content: 'abc', mtimeMs: 5 },
      'snapshots/a1.json': { content: '{}', mtimeMs: 7 },
    })

    const sources = await listSources(fake.fs)

    expect(fake.calls.list).toEqual(['events', 'snapshots'])
    expect(sources).toEqual({ 'events/s1.jsonl': { size: 3, mtimeMs: 5 }, 'snapshots/a1.json': { size: 2, mtimeMs: 7 } })
  })

  test('a missing directory yields no sources from it and does not throw', async () => {
    const onlySnapshots = await listSources(createFakeFs({ 'snapshots/a1.json': { content: '{}' } }).fs)
    const nothing = await listSources(createFakeFs({}).fs)

    expect(Object.keys(onlySnapshots)).toEqual(['snapshots/a1.json'])
    expect(nothing).toEqual({})
  })
})

describe('readLines', () => {
  test('reassembles a line split across chunks', async () => {
    expect(await linesOf('{"a":1}\n{"b":2}\n', 5)).toEqual({ ok: true, lines: ['{"a":1}', '{"b":2}'] })
  })

  test('decodes a multibyte character cut by a chunk edge without U+FFFD', async () => {
    const content = '{"t":"é"}\n'
    const result = await linesOf(content, 7)

    expect(result).toEqual({ ok: true, lines: ['{"t":"é"}'] })
  })

  test('issues sequential ranged byte reads of the chunk length until the size is covered', async () => {
    const content = '{"a":1}\n{}\n'
    const fake = createFakeFs({ [FILE]: { content } })

    await readLines(fake.fs, FILE, sizeOf(content), 4)

    expect(fake.calls.read.map((call) => call.options)).toEqual([
      { as: 'bytes', offset: 0, length: 4 },
      { as: 'bytes', offset: 4, length: 4 },
      { as: 'bytes', offset: 8, length: 4 },
    ])
  })

  test('keeps a final line without newline only when it is valid JSON', async () => {
    expect(await linesOf('{"a":1}\n{"b":2}')).toEqual({ ok: true, lines: ['{"a":1}', '{"b":2}'] })
    expect(await linesOf('{"a":1}\n{"b":')).toEqual({ ok: true, lines: ['{"a":1}'] })
  })

  test('an empty file returns no lines', async () => {
    expect(await linesOf('')).toEqual({ ok: true, lines: [] })
  })

  test('a failing read returns a skip instead of throwing', async () => {
    const { fs } = createFakeFs({ [FILE]: { content: '{}\n' } }, [FILE])

    expect(await readLines(fs, FILE, 3)).toEqual({ ok: false })
  })
})
