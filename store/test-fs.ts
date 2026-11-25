import type { SourceStat } from '../aggregates/types'
import type { HistoryFs } from './load-history'

export type FakeFiles = Record<string, { content: string; mtimeMs?: number }>

const ENCODER = new TextEncoder()
const DEFAULT_MTIME_MS = 1

export const jsonl = (records: readonly unknown[]): string => records.map((record) => JSON.stringify(record)).join('\n') + '\n'

/** In-memory fs seam: paths are store-relative, a directory exists while any file lies under it. */
export const createFakeFs = (files: FakeFiles, failingPaths: readonly string[] = []) => {
  const calls = { list: [] as string[], read: [] as Array<{ path: string; options: { as: 'bytes'; offset: number; length: number } }>, readText: [] as string[] }
  const bytesOf = (path: string): Uint8Array => {
    const file = files[path]
    if (!file || failingPaths.includes(path)) throw new Error(`ENOENT ${path}`)
    return ENCODER.encode(file.content)
  }

  const fs: HistoryFs = {
    list: async (dir) => {
      calls.list.push(dir)
      const entries = Object.entries(files)
        .filter(([path]) => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/'))
        .map(([path, file]) => ({
          name: path.slice(dir.length + 1),
          kind: 'file' as const,
          size: ENCODER.encode(file.content).length,
          mtimeMs: file.mtimeMs ?? DEFAULT_MTIME_MS,
        }))
      if (entries.length === 0) throw new Error(`ENOENT ${dir}`)
      return entries
    },
    read: async (path, options) => {
      calls.read.push({ path, options })
      const slice = bytesOf(path).slice(options.offset, options.offset + options.length)
      return { base64: btoa(String.fromCharCode(...slice)) }
    },
    readText: async (path) => {
      calls.readText.push(path)
      bytesOf(path)
      return files[path]?.content ?? ''
    },
  }

  const statOf = (path: string): SourceStat => {
    const file = files[path]
    if (!file) throw new Error(`no fake file ${path}`)
    return { size: ENCODER.encode(file.content).length, mtimeMs: file.mtimeMs ?? DEFAULT_MTIME_MS }
  }

  const readPaths = (): string[] => [...calls.read.map((call) => call.path), ...calls.readText]
  return { fs, files, calls, statOf, readPaths }
}

/** Records every upsert; with `files` given, a write lands in the fake store so a later load sees it. */
export const createRecordingWriter = (files?: FakeFiles, behavior: 'ok' | 'false' | 'throw' = 'ok') => {
  const writes: Array<{ path: string; text: string }> = []
  let inFlight = 0
  let maxInFlight = 0
  const writer = {
    upsert: async (path: string, text: string): Promise<boolean> => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      await Promise.resolve()
      inFlight -= 1
      writes.push({ path, text })
      if (behavior === 'throw') throw new Error('writer exploded')
      if (behavior === 'false') return false
      if (files) files[path] = { content: text }
      return true
    },
  }
  return { writer, writes, maxInFlight: () => maxInFlight }
}
