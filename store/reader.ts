import type { SourceListing } from '../aggregates/types'

export const READ_CHUNK_BYTES = 4 * 1024 * 1024

const SOURCE_DIRS = [
  { dir: 'events', extension: '.jsonl' },
  { dir: 'snapshots', extension: '.json' },
] as const
const NEWLINE = 0x0a

export type ListedEntry = { name: string; kind: 'file' | 'dir' | 'other'; size: number; mtimeMs: number }
export type ReaderFs = {
  list: (path: string) => Promise<readonly ListedEntry[]>
  read: (path: string, options: { as: 'bytes'; offset: number; length: number }) => Promise<{ base64: string }>
}
export type ReadLinesResult = { ok: true; lines: string[] } | { ok: false }

export async function listSources(fs: ReaderFs): Promise<SourceListing> {
  const listing: Record<string, { size: number; mtimeMs: number }> = Object.create(null)
  for (const { dir, extension } of SOURCE_DIRS) {
    const entries = await fs.list(dir).catch(() => [])
    for (const entry of entries) {
      if (entry.kind === 'file' && entry.name.endsWith(extension)) listing[`${dir}/${entry.name}`] = { size: entry.size, mtimeMs: entry.mtimeMs }
    }
  }
  return listing
}

const isValidJson = (text: string): boolean => {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

const concat = (head: Uint8Array, tail: Uint8Array): Uint8Array => {
  const joined = new Uint8Array(head.length + tail.length)
  joined.set(head)
  joined.set(tail, head.length)
  return joined
}

export async function readLines(fs: ReaderFs, path: string, size: number, chunkBytes: number = READ_CHUNK_BYTES): Promise<ReadLinesResult> {
  const decoder = new TextDecoder()
  const lines: string[] = []
  let carry = new Uint8Array(0)
  try {
    for (let offset = 0; offset < size; offset += chunkBytes) {
      const { base64 } = await fs.read(path, { as: 'bytes', offset, length: chunkBytes })
      const bytes = concat(carry, Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)))
      let lineStart = 0
      for (let index = bytes.indexOf(NEWLINE); index !== -1; index = bytes.indexOf(NEWLINE, lineStart)) {
        lines.push(decoder.decode(bytes.subarray(lineStart, index)))
        lineStart = index + 1
      }
      carry = bytes.slice(lineStart)
    }
  } catch {
    return { ok: false }
  }
  const last = decoder.decode(carry)
  if (last.trim() !== '' && isValidJson(last)) lines.push(last)
  return { ok: true, lines: lines.filter((line) => line.trim() !== '') }
}
