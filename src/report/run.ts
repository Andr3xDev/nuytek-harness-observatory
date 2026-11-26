import type { PluginOptions } from 'claude-code'
import { historyFsOf } from '../store/read/history-fs'
import type { HistoryFs } from '../store/read/load-history'
import { createWriter, type ProcessRunner } from '../store/write/writer'
import { handleReport } from './command'

/**
 * Closures over `$`, built inline by the `/obs` hook: the plugin validator rejects `$` as a value, and
 * `command.run{obs}` can be registered once, so the panel module owns the hook and calls this for `report`.
 */
export type ReportHost = {
  home: () => Promise<string | undefined>
  list: HistoryFs['list']
  read: HistoryFs['read']
  readText: HistoryFs['readText']
  run: ProcessRunner
}

export const runReportCommand = async (host: ReportHost, options: PluginOptions, columns: number) => {
  const home = await host.home()
  return handleReport({
    fs: historyFsOf(home, { list: host.list, read: host.read, readText: host.readText }),
    writer: createWriter(host.run),
    options,
    now: Date.now(),
    columns,
  })
}
