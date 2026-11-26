import { describe, expect, test } from 'claude-code/testing'
import {
  HISTORY_MAX_AGE_MS,
  OPEN_TIMER_MS,
  REFRESH_MIN_INTERVAL_MS,
  STATE_SHAPES,
  bandEnabledAtom,
  historyAtom,
  scopeAtom,
  sessionAtom,
  tabAtom,
  tickAtom,
} from './state'

describe('panel state atoms', () => {
  test('defaults', () => {
    expect(tabAtom.initial).toBe(1)
    expect(scopeAtom.initial).toBe('session')
    expect(tickAtom.initial).toBe(0)
    expect(sessionAtom.initial).toBeNull()
    expect(historyAtom.initial).toEqual({ status: 'idle' })
    expect(bandEnabledAtom.initial).toBe(true)
  })

  test('every atom carries its shape tag', () => {
    const atoms = { tab: tabAtom, scope: scopeAtom, tick: tickAtom, session: sessionAtom, history: historyAtom, bandEnabled: bandEnabledAtom }
    for (const [key, a] of Object.entries(atoms)) {
      expect(a.shape).toBe(STATE_SHAPES[key as keyof typeof STATE_SHAPES])
      expect(a.ref.key).toBe(key)
    }
    expect(Object.values(STATE_SHAPES)).toEqual(['tab-1', 'scope-1', 'tick-1', 'session-1', 'history-1', 'band-1'])
  })

  test('refresh constants', () => {
    expect(REFRESH_MIN_INTERVAL_MS).toBe(3000)
    expect(OPEN_TIMER_MS).toBe(5000)
    expect(HISTORY_MAX_AGE_MS).toBe(60000)
  })
})
