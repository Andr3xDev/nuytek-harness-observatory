import type { HistoryFs } from './history-fs'

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

  const readPaths = (): string[] => [...calls.read.map((call) => call.path), ...calls.readText]
  return { fs, files, calls, readPaths }
}
