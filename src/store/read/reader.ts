import type { SourceListing } from '../../core/figures'
import { tryParseJson } from '../../core/guards'
import { EVENTS_DIR, EVENTS_EXTENSION, SNAPSHOTS_DIR, SNAPSHOT_EXTENSION } from '../layout'

export const READ_CHUNK_BYTES = 4 * 1024 * 1024

const SOURCE_DIRS = [
  { dir: EVENTS_DIR, extension: EVENTS_EXTENSION },
  { dir: SNAPSHOTS_DIR, extension: SNAPSHOT_EXTENSION },
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

const decodeBase64 = (base64: string): Uint8Array => {
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let index = 0; index < raw.length; index++) bytes[index] = raw.charCodeAt(index)
  return bytes
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
      const bytes = concat(carry, decodeBase64(base64))
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
  if (last.trim() !== '' && tryParseJson(last) !== undefined) lines.push(last)
  return { ok: true, lines: lines.filter((line) => line.trim() !== '') }
}
