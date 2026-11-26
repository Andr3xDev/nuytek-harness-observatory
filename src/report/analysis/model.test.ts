import { describe, expect, test } from 'claude-code/testing'
import { modelOf } from './model'
import { usage } from './test-fixtures'

describe('modelOf', () => {
  test('the recorded model wins over the usage entries', () => {
    expect(modelOf([usage(1, 50, 0, 0, 'haiku-x')], 'sonnet-x')).toBe('sonnet-x')
  })

  test('without a recorded model the entry with the largest output wins', () => {
    expect(modelOf([usage(1, 5, 0, 0, 'sonnet-x'), usage(1, 90, 0, 0, 'opus-x')], '')).toBe('opus-x')
  })

  test('a small classifier entry at the end does not win', () => {
    expect(modelOf([usage(1, 400, 0, 0, 'sonnet-x'), usage(1, 3, 0, 0, 'haiku-x')])).toBe('sonnet-x')
  })

  test('no usage and no recorded model is null', () => {
    expect(modelOf([])).toBeNull()
  })
})
