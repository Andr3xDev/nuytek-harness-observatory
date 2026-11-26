import { STORE_DIR } from '../../core/constants'
import type { ReaderFs } from './reader'

export type HistoryFs = ReaderFs & { readText: (path: string) => Promise<string> }

/** Roots the store file system at `$HOME/.claude/observability`; without HOME every read fails, which yields the no-data view. */
export const historyFsOf = (home: string | undefined, fs: HistoryFs): HistoryFs => {
  if (!home) {
    const unreadable = (): Promise<never> => Promise.reject(new Error('HOME is not set'))
    return { list: unreadable, read: unreadable, readText: unreadable }
  }
  const root = `${home}/${STORE_DIR}`
  return {
    list: (path) => fs.list(`${root}/${path}`),
    read: (path, range) => fs.read(`${root}/${path}`, range),
    readText: (path) => fs.readText(`${root}/${path}`),
  }
}
