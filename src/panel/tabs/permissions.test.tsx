import { describe, expect, test } from 'claude-code/testing'
import type { ToolFigures } from '../../core/figures'
import { permissionsLines } from './permissions'
import { aggregate, context, emptyTools, profile, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const view = (tools: Partial<ToolFigures>, withProfile: ReturnType<typeof profile> | null = profile()) =>
  textOf(
    permissionsLines(
      context('wide', { session: sessionAtomValue(sessionFigures(), aggregate({ tools: { ...emptyTools(), ...tools }, profile: withProfile })) }),
    ),
  )

describe('permissions tab', () => {
  test('two denies from one guard show their count, guard and reason', () => {
    const text = view(
      { verdicts: { builder: { allow: 1, ask: 0, deny: 2 }, main: { allow: 5, ask: 1, deny: 0 } }, denyReasons: { 'bash blocked': 2 } },
      profile({ guards: { 'infra-agent-bash-guard': 2 } }),
    )
    expect(text).toMatch(/^builder .*1 .*0 .*2$/m)
    expect(text).toMatch(/^main .*5 .*1 .*0$/m)
    expect(text).toMatch(/^infra-agent-bash-guard .*2$/m)
    expect(text).toMatch(/^bash blocked .*2$/m)
  })

  test('no permission outcomes renders without a prompts section or an error', () => {
    expect(view({})).not.toContain('Permission prompts')
  })

  test('outcomes render when present', () => {
    expect(view({ outcomes: { allowed: 3 } })).toMatch(/Permission prompts[\s\S]*^allowed .*3$/m)
  })

  test('hook cost is estimated, with a dollar figure only when calibrated', () => {
    expect(view({ bashPromptHook: { calls: 4, usd: 0.02 } })).toContain('Bash prompt hook (estimated): 4 calls · $0.02')
    const uncalibrated = view({ bashPromptHook: { calls: 4, usd: null } })
    expect(uncalibrated).toContain('Bash prompt hook (estimated): 4 calls · cost not calibrated')
    expect(uncalibrated).not.toContain('$')
  })

  test('a null hook figure is n/a with the profile wording', () => {
    expect(view({ bashPromptHook: null })).toContain('Bash prompt hook (estimated): n/a (harness profile off)')
  })

  test('a profile-off fixture shows n/a guard cells and one footnote, not 0', () => {
    const text = view({}, null)
    expect(text).toMatch(/^\(all guards\) .*n\/a$/m)
    expect(text.match(/n\/a: harness profile off/g)).toHaveLength(1)
  })

  test('a real zero guard count renders 0', () => {
    expect(view({}, profile({ guards: { g: 0 } }))).toMatch(/^g .*0$/m)
  })

  test('never shows timing or latency', () => {
    const text = view({ verdicts: { builder: { allow: 1, ask: 1, deny: 1 } }, bashPromptHook: { calls: 1, usd: 0.01 } })
    expect(text).not.toMatch(/latency|\dms/i)
  })
})
