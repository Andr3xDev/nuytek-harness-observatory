import { atom } from 'claude-code'

export const REFRESH_MIN_INTERVAL_MS = 3000
export const OPEN_TIMER_MS = 5000
export const HISTORY_MAX_AGE_MS = 60000

export const STATE_SHAPES = {
  tab: 'tab-1',
  scope: 'scope-1',
  tick: 'tick-1',
  session: 'session-1',
  history: 'history-1',
  bandEnabled: 'band-1',
} as const

// The hooks scan accepts only string-literal `plugin` and `key`, and only for atoms declared in the file that reads them.
export const tabAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tab' } as const, 1, { shape: STATE_SHAPES.tab })
export const scopeAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
export const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
export const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
export const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
export const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })
