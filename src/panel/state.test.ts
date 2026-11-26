import { describe, expect, test } from 'claude-code/testing'
import { STATE_SHAPES } from './state'

describe('panel state shapes', () => {
  // A tag is bumped together with a state migration; an accidental edit must fail here.
  test('shape tags are pinned', () => {
    expect(Object.values(STATE_SHAPES)).toEqual(['tab-1', 'tick-1', 'session-3', 'history-3', 'open-1'])
  })
})
