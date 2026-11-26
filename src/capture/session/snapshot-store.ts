import { RESUME_SWEEP_WINDOW_MS, STORE_DIR } from '../../core/constants'
import type { AgentSnapshot } from '../../core/schema'
import type { StoredSnapshot } from './snapshots'

const SNAPSHOTS_DIR = `${STORE_DIR}/snapshots`
const SNAPSHOT_EXTENSION = '.json'

type SnapshotFs = {
  home: () => Promise<string | undefined>
  list: (dir: string) => Promise<Array<{ name: string; kind: string; mtimeMs: number }>>
  read: (path: string) => Promise<string>
}

/** Only the fields the sweep reads; a file from an older or damaged write is skipped, not fatal. */
const isSnapshotShape = (value: unknown): value is AgentSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>).sessionId === 'string' &&
  typeof (value as Record<string, unknown>).closed === 'boolean'

export const listStoredSnapshots = async (fs: SnapshotFs): Promise<StoredSnapshot[]> => {
  try {
    const home = await fs.home()
    if (!home) return []
    const dir = `${home}/${SNAPSHOTS_DIR}`
    const recent = (await fs.list(dir)).filter(
      (entry) =>
        entry.kind === 'file' && entry.name.endsWith(SNAPSHOT_EXTENSION) && Date.now() - entry.mtimeMs <= RESUME_SWEEP_WINDOW_MS,
    )
    const stored = await Promise.all(
      recent.map(async (entry): Promise<StoredSnapshot | null> => {
        try {
          const parsed: unknown = JSON.parse(await fs.read(`${dir}/${entry.name}`))
          if (!isSnapshotShape(parsed)) return null
          return { name: entry.name, mtimeMs: entry.mtimeMs, snapshot: parsed }
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
