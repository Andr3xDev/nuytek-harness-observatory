import { describe, expect, test } from 'claude-code/testing'
import {
  APPEND_SCRIPT,
  INIT_SCRIPT,
  MAINTAIN_SCRIPT,
  UPSERT_SCRIPT,
  appendArgv,
  initArgv,
  maintainArgv,
  upsertArgv,
} from './scripts'

const SAFE_PREFIX = 'umask 077; cd "$HOME/.claude/observability" || exit 1'

describe('script constants', () => {
  for (const [name, script] of [
    ['APPEND', APPEND_SCRIPT],
    ['UPSERT', UPSERT_SCRIPT],
    ['MAINTAIN', MAINTAIN_SCRIPT],
  ] as const) {
    test(`${name} starts with umask and the fail-closed cd`, () => {
      expect(script).toStartWith(SAFE_PREFIX)
    })
  }

  test('INIT guards an empty HOME and creates only the fixed root, with no cd or interpolation', () => {
    expect(INIT_SCRIPT).toStartWith('umask 077;')
    expect(INIT_SCRIPT).toContain('[ -n "$HOME" ] || exit 1')
    expect(INIT_SCRIPT).toEndWith('mkdir -p -- "$HOME/.claude/observability"')
    expect(INIT_SCRIPT).not.toContain('cd ')
    expect(INIT_SCRIPT).not.toContain('$1')
    expect(initArgv()).toEqual(['sh', '-c', INIT_SCRIPT, 'observatory'])
  })

  test('MAINTAIN limits find to the known entries and regular files', () => {
    expect(MAINTAIN_SCRIPT).toContain('find events snapshots -type f -mtime +"$1"')
    expect(MAINTAIN_SCRIPT).not.toContain('prompts')
    expect(MAINTAIN_SCRIPT).toContain('! -name "$2" ! -name "$3"')
    expect(MAINTAIN_SCRIPT).not.toContain('find /')
    expect(MAINTAIN_SCRIPT).not.toContain('find ~')
  })
})

describe('append and upsert scripts', () => {
  const dollarTokens = (script: string): string[] => script.match(/\$(\{[^}]*\}|\$|\w+)/g) ?? []

  test('the path only ever arrives as the positional $1', () => {
    expect(new Set(dollarTokens(APPEND_SCRIPT))).toEqual(new Set(['$HOME', '$1', '${1%/*}']))
    expect(new Set(dollarTokens(UPSERT_SCRIPT))).toEqual(new Set(['$HOME', '$1', '${1%/*}', '$$']))
  })

  test('UPSERT writes a temp file named by the pid, then moves it over the target', () => {
    expect(UPSERT_SCRIPT).toContain('cat > "$1.tmp.$$" && mv -f "$1.tmp.$$" "$1"')
  })
})

describe('argv builders', () => {
  test('append and upsert argv carry only the path', () => {
    expect(appendArgv('events/s1.jsonl')).toEqual(['sh', '-c', APPEND_SCRIPT, 'observatory', 'events/s1.jsonl'])
    expect(upsertArgv('snapshots/a1.json')).toEqual(['sh', '-c', UPSERT_SCRIPT, 'observatory', 'snapshots/a1.json'])
  })

  test('maintain argv carries the days and both excluded names', () => {
    expect(maintainArgv('30', 's1.jsonl', 'main-s1.json')).toEqual(['sh', '-c', MAINTAIN_SCRIPT, 'observatory', '30', 's1.jsonl', 'main-s1.json'])
  })
})
