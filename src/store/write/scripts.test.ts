import { describe, expect, test } from 'claude-code/testing'
import {
  APPEND_SCRIPT,
  INIT_SCRIPT,
  MAINTAIN_SCRIPT,
  UPSERT_SCRIPT,
  initArgv,
  maintainArgv,
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

  test('MAINTAIN limits find to the four known entries and regular files', () => {
    expect(MAINTAIN_SCRIPT).toContain('find events snapshots rollup -type f -mtime +"$1"')
    expect(MAINTAIN_SCRIPT).toContain("-maxdepth 1 -type f -name 'prompts-*.jsonl' -mtime +\"$1\"")
    expect(MAINTAIN_SCRIPT).toContain('! -name "$2" ! -name "$3"')
    expect(MAINTAIN_SCRIPT).not.toContain('find /')
    expect(MAINTAIN_SCRIPT).not.toContain('find ~')
  })
})

describe('argv builders', () => {
  test('maintain argv carries the days and both excluded names', () => {
    for (const days of ['30', '60', '90']) {
      expect(maintainArgv(days, 's1.jsonl', 'main-s1.json')).toEqual(['sh', '-c', MAINTAIN_SCRIPT, 'observatory', days, 's1.jsonl', 'main-s1.json'])
    }
  })
})
