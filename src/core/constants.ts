const MS_PER_DAY = 24 * 60 * 60 * 1000

/** Store root, relative to `$HOME`. */
export const STORE_DIR = '.claude/observability'

/** Reconciliation tolerance is max(DRIFT_ABS_USD, DRIFT_REL * |sessionUsd|). */
const DRIFT_ABS_USD = 0.01
const DRIFT_REL = 0.01
export const driftToleranceOf = (usd: number): number => Math.max(DRIFT_ABS_USD, DRIFT_REL * Math.abs(usd))

export const FLUSH_INTERVAL_MS = 10_000
export const MAX_BATCH_EVENTS = 200
export const MAX_BATCH_BYTES = 65_536
export const MAX_BUFFERED_EVENTS = 2_000

export const RESUME_SWEEP_WINDOW_MS = 7 * MS_PER_DAY

/** The History tab reads only sessions whose events file changed within this many days. */
const HISTORY_WINDOW_DAYS = 7
export const HISTORY_WINDOW_MS = HISTORY_WINDOW_DAYS * MS_PER_DAY

export const REPORT_EXCERPT_MAX_BYTES = 3_072

export const RECENT_AGENTS_CAP = 20

/** Bump when the `status:` / `SKILLS:` parsing rules change. */
export const PARSER_VERSION = 1
