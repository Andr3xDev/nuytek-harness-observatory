import { describe, expect, test } from 'claude-code/testing'
import { effortLabel } from './effort'

describe('effortLabel', () => {
  test('is empty when the agent took the session effort', () => {
    for (const effort of [null, undefined, '']) expect(effortLabel(effort)).toBe('')
  })

  test('a known level gets its icon', () => {
    expect(effortLabel('medium')).toBe('◔ medium')
  })

  test('a numeric budget gets the diamond', () => {
    expect(effortLabel(8000)).toBe('◇ 8000')
  })

  test('an unknown level keeps its text with the diamond', () => {
    expect(effortLabel('bogus')).toBe('◇ bogus')
  })
})
