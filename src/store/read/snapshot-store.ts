import { RESUME_SWEEP_WINDOW_MS, STORE_DIR } from '../../core/constants'
import { isRecord } from '../../core/guards'
import type { AgentSnapshot } from '../../core/schema'

const SNAPSHOTS_DIR = `${STORE_DIR}/snapshots`
const SNAPSHOT_EXTENSION = '.json'

export type StoredSnapshot = { name: string; mtimeMs: number; snapshot: AgentSnapshot }

type SnapshotFs = {
  home: () => Promise<string | undefined>
  list: (dir: string) => Promise<Array<{ name: string; kind: string; mtimeMs: number }>>
  read: (path: string) => Promise<string>
}

/** Only the fields the sweep reads; a file from an older or damaged write is skipped, not fatal. */
const isSnapshotShape = (value: unknown): value is AgentSnapshot =>
  isRecord(value) && typeof value.sessionId === 'string' && typeof value.closed === 'boolean'

/** Readable snapshot files inside the resume window; older files are never read. Any failure yields no snapshots. */
export const listStoredSnapshots = async (fs: SnapshotFs, now: number): Promise<StoredSnapshot[]> => {
  try {
    const home = await fs.home()
    if (!home) return []
    const dir = `${home}/${SNAPSHOTS_DIR}`
    const files = (await fs.list(dir)).filter(
      (entry) => entry.kind === 'file' && entry.name.endsWith(SNAPSHOT_EXTENSION) && now - entry.mtimeMs <= RESUME_SWEEP_WINDOW_MS,
    )
    const stored = await Promise.all(
      files.map(async (entry): Promise<StoredSnapshot | null> => {
        try {
          const parsed: unknown = JSON.parse(await fs.read(`${dir}/${entry.name}`))
          return isSnapshotShape(parsed) ? { name: entry.name, mtimeMs: entry.mtimeMs, snapshot: parsed } : null
        } catch {
          return null
        }
      }),
    )
    return stored.filter((entry) => entry !== null)
  } catch {
    return []
  }
}
