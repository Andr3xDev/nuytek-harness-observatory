import { describe, expect, test } from 'claude-code/testing'
import { BASH_PROMPT_HOOK_COST_USD_PER_CALL, createBashCallTracker } from './estimates'

const PER_CALL_USD = 0.002

describe('Bash prompt-hook estimate', () => {
  test('the shipped per-call cost is uncalibrated', () => {
    expect(BASH_PROMPT_HOOK_COST_USD_PER_CALL).toBeNull()
  })

  test('profile off produces no estimate', () => {
    const tracker = createBashCallTracker(false)
    tracker.recordVerdict('Bash', 'tu1')
    expect(tracker.estimate()).toBeUndefined()
  })

  test('uncalibrated estimate has the label and call count but no cost keys', () => {
    const tracker = createBashCallTracker(true)
    tracker.recordVerdict('Bash', 'tu1')
    tracker.recordVerdict('Bash', 'tu2')
    const estimate = tracker.estimate(null)
    expect(estimate?.bashPromptHook.label).toBe('estimated')
    expect(estimate?.bashPromptHook.calls).toBe(2)
    expect(Object.keys(estimate?.bashPromptHook ?? {}).sort()).toEqual(['calls', 'label'])
  })

  test('calibrated estimate multiplies calls by the per-call cost and stays labeled estimated', () => {
    const tracker = createBashCallTracker(true)
    for (const id of ['tu1', 'tu2', 'tu3']) tracker.recordVerdict('Bash', id)
    const hook = tracker.estimate(PER_CALL_USD)?.bashPromptHook
    expect(hook?.label).toBe('estimated')
    expect(hook?.perCallUsd).toBe(PER_CALL_USD)
    expect(Math.abs((hook?.usd ?? 0) - 3 * PER_CALL_USD)).toBeLessThan(1e-9)
  })

  test('the same toolUseId is counted once and other tools are ignored', () => {
    const tracker = createBashCallTracker(true)
    tracker.recordVerdict('Bash', 'tu1')
    tracker.recordVerdict('Bash', 'tu1')
    tracker.recordVerdict('Read', 'tu2')
    expect(tracker.estimate(null)?.bashPromptHook.calls).toBe(1)
  })
})
