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
const SCRIPT_ARGV_INDEX = 2

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

  test('APPEND creates the parent directory then appends stdin to $1', () => {
    expect(APPEND_SCRIPT).toContain('mkdir -p -- "${1%/*}"')
    expect(APPEND_SCRIPT).toContain('cat >> "$1"')
  })

  test('UPSERT writes a temp file then renames it over $1', () => {
    expect(UPSERT_SCRIPT).toContain('cat > "$1.tmp" && mv -f "$1.tmp" "$1"')
  })

  test('MAINTAIN limits find to the four known entries and regular files', () => {
    expect(MAINTAIN_SCRIPT).toContain('find events snapshots rollup -type f -mtime +"$1"')
    expect(MAINTAIN_SCRIPT).toContain("-maxdepth 1 -type f -name 'prompts-*.jsonl' -mtime +\"$1\"")
    expect(MAINTAIN_SCRIPT).toContain('! -name "$2" ! -name "$3"')
    expect(MAINTAIN_SCRIPT).not.toContain('find /')
    expect(MAINTAIN_SCRIPT).not.toContain('find ~')
  })
})

describe('argv builders', () => {
  test('append argv is the fixed script with the path as a positional arg', () => {
    expect(appendArgv('events/a.jsonl')).toEqual(['sh', '-c', APPEND_SCRIPT, 'observatory', 'events/a.jsonl'])
  })

  test('upsert argv is the fixed script with the path as a positional arg', () => {
    expect(upsertArgv('snapshots/a.json')).toEqual(['sh', '-c', UPSERT_SCRIPT, 'observatory', 'snapshots/a.json'])
  })

  test('the script string never changes with the target path', () => {
    expect(appendArgv('events/a.jsonl')[SCRIPT_ARGV_INDEX]).toBe(appendArgv('prompts-2026-11-25.jsonl')[SCRIPT_ARGV_INDEX])
    expect(upsertArgv('snapshots/a.json')[SCRIPT_ARGV_INDEX]).toBe(upsertArgv('rollup/b.json')[SCRIPT_ARGV_INDEX])
  })

  for (const days of ['30', '60', '90']) {
    test(`maintain argv for ${days} days carries the days and both excluded names`, () => {
      expect(maintainArgv(days, 's1.jsonl', 'main-s1.json')).toEqual([
        'sh',
        '-c',
        MAINTAIN_SCRIPT,
        'observatory',
        days,
        's1.jsonl',
        'main-s1.json',
      ])
    })
  }
})
