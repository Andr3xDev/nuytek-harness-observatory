// Fixed scripts: no caller text is ever interpolated; paths go in as positional args (design D7).
const SAFE_PREFIX = 'umask 077; cd "$HOME/.claude/observability" || exit 1'
const SCRIPT_NAME = 'observatory'

// Creates the store root: the other scripts `cd` into it fail-closed, so a first run needs it to exist.
export const INIT_SCRIPT = 'umask 077; [ -n "$HOME" ] || exit 1; mkdir -p -- "$HOME/.claude/observability"'

export const APPEND_SCRIPT = `${SAFE_PREFIX}; case "$1" in */*) mkdir -p -- "\${1%/*}";; esac; cat >> "$1"`

export const UPSERT_SCRIPT = `${SAFE_PREFIX}; case "$1" in */*) mkdir -p -- "\${1%/*}";; esac; cat > "$1.tmp" && mv -f "$1.tmp" "$1"`

export const MAINTAIN_SCRIPT =
  `${SAFE_PREFIX}; chmod -R go-rwx . ; ` +
  'find events snapshots rollup -type f -mtime +"$1" ! -name "$2" ! -name "$3" -delete 2>/dev/null; ' +
  `find . -maxdepth 1 -type f -name 'prompts-*.jsonl' -mtime +"$1" -delete`

const shellArgv = (script: string, ...args: string[]): string[] => ['sh', '-c', script, SCRIPT_NAME, ...args]

export const initArgv = (): string[] => shellArgv(INIT_SCRIPT)
export const appendArgv = (path: string): string[] => shellArgv(APPEND_SCRIPT, path)
export const upsertArgv = (path: string): string[] => shellArgv(UPSERT_SCRIPT, path)
export const maintainArgv = (days: string, eventsFile: string, snapshotFile: string): string[] =>
  shellArgv(MAINTAIN_SCRIPT, days, eventsFile, snapshotFile)
