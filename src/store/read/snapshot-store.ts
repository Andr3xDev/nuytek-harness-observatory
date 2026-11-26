import { RESUME_SWEEP_WINDOW_MS, STORE_DIR } from '../../core/constants'
import { isSnapshotShape, tryParseJson } from '../../core/guards'
import type { AgentSnapshot } from '../../core/schema'
import { SNAPSHOTS_DIR, SNAPSHOT_EXTENSION } from '../layout'

/** Bounds the reads of a session start; the newest files are the ones a resume can still own. */
export const MAX_SWEEP_SNAPSHOTS = 64

const SNAPSHOTS_PATH = `${STORE_DIR}/${SNAPSHOTS_DIR}`

export type StoredSnapshot = { name: string; mtimeMs: number; snapshot: AgentSnapshot }

type SnapshotFs = {
  home: () => Promise<string | undefined>
  list: (dir: string) => Promise<Array<{ name: string; kind: string; mtimeMs: number }>>
  read: (path: string) => Promise<string>
}

/** Readable snapshot files inside the resume window; older files are never read. Any failure yields no snapshots. */
export const listStoredSnapshots = async (fs: SnapshotFs, now: number): Promise<StoredSnapshot[]> => {
  try {
    const home = await fs.home()
    if (!home) return []
    const dir = `${home}/${SNAPSHOTS_PATH}`
    const files = (await fs.list(dir))
      .filter((entry) => entry.kind === 'file' && entry.name.endsWith(SNAPSHOT_EXTENSION) && now - entry.mtimeMs <= RESUME_SWEEP_WINDOW_MS)
      .sort((left, right) => right.mtimeMs - left.mtimeMs)
      .slice(0, MAX_SWEEP_SNAPSHOTS)
    const stored = await Promise.all(
      files.map(async (entry): Promise<StoredSnapshot | null> => {
        const parsed = await fs.read(`${dir}/${entry.name}`).then(tryParseJson, () => undefined)
        return isSnapshotShape(parsed) ? { name: entry.name, mtimeMs: entry.mtimeMs, snapshot: parsed } : null
      }),
    )
    return stored.filter((entry) => entry !== null)
  } catch {
    return []
  }
}
