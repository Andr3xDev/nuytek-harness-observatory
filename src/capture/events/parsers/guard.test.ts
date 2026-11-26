import { describe, expect, test } from 'claude-code/testing'
import { parseGuardName } from './guard'

describe('parseGuardName', () => {
  const cases: ReadonlyArray<readonly [string, string | null | undefined, string | null]> = [
    ['guard prefix', 'Blocked by infra-agent-bash-guard: rm is not allowed', 'infra-agent-bash-guard'],
    ['reason without prefix', 'Denied by user rule', null],
    ['prefix not at the start', 'note: Blocked by x-guard: no', null],
    ['prefix without colon', 'Blocked by x-guard', null],
    ['empty reason', '', null],
    ['null reason', null, null],
    ['undefined reason', undefined, null],
  ]

  for (const [name, reason, expected] of cases) {
    test(name, () => {
      expect(parseGuardName(reason)).toBe(expected)
    })
  }
})
