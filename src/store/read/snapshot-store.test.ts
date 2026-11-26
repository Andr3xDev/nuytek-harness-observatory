import { describe, expect, test } from 'claude-code/testing'
import { RESUME_SWEEP_WINDOW_MS } from '../../core/constants'
import { listStoredSnapshots } from './snapshot-store'

const HOME = '/home/u'
const DIR = `${HOME}/.claude/observability/snapshots`
const NOW = 10 * RESUME_SWEEP_WINDOW_MS
const open = { sessionId: 's1', closed: false }

const fsOf = (files: Record<string, string>, ageMs = 0) => ({
  home: async (): Promise<string | undefined> => HOME,
  list: async () => Object.keys(files).map((name) => ({ name, kind: 'file', mtimeMs: NOW - ageMs })),
  read: async (path: string) => files[path.slice(DIR.length + 1)] ?? Promise.reject(new Error('ENOENT')),
})

describe('listStoredSnapshots', () => {
  test('returns the readable snapshot files with their name and mtime', async () => {
    const stored = await listStoredSnapshots(fsOf({ 'a1.json': JSON.stringify(open), 'notes.txt': 'x' }), NOW)

    expect(stored).toEqual([{ name: 'a1.json', mtimeMs: NOW, snapshot: open }])
  })

  test('skips files that are not valid JSON or lack the sweep fields', async () => {
    const stored = await listStoredSnapshots(
      fsOf({ 'ok.json': JSON.stringify(open), 'bad.json': '{', 'old.json': JSON.stringify({ sessionId: 's1' }), 'null.json': 'null' }),
      NOW,
    )

    expect(stored.map((entry) => entry.name)).toEqual(['ok.json'])
  })

  test('keeps a file at the window edge and never reads one older than it', async () => {
    const reads: string[] = []
    const withAge = (ageMs: number) => {
      const fs = fsOf({ 'a1.json': JSON.stringify(open) }, ageMs)
      return { ...fs, read: async (path: string) => (reads.push(path), fs.read(path)) }
    }

    expect(await listStoredSnapshots(withAge(RESUME_SWEEP_WINDOW_MS), NOW)).toHaveLength(1)
    reads.length = 0
    expect(await listStoredSnapshots(withAge(RESUME_SWEEP_WINDOW_MS + 1), NOW)).toEqual([])
    expect(reads).toEqual([])
  })

  test('a missing HOME yields no snapshots', async () => {
    const noHome = { ...fsOf({ 'a1.json': JSON.stringify(open) }), home: async () => undefined }

    expect(await listStoredSnapshots(noHome, NOW)).toEqual([])
  })

  test('a failing list yields no snapshots instead of throwing', async () => {
    const failing = { home: async () => HOME, list: () => Promise.reject(new Error('EACCES')), read: async () => '' }

    expect(await listStoredSnapshots(failing, NOW)).toEqual([])
  })
})
