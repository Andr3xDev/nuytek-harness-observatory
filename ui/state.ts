import { atom } from 'claude-code'

export const PLUGIN_KEY = 'nuytek-harness-observatory'

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

export const tabAtom = atom({ plugin: PLUGIN_KEY, key: 'tab' } as const, 1, { shape: STATE_SHAPES.tab })
export const scopeAtom = atom({ plugin: PLUGIN_KEY, key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
export const tickAtom = atom({ plugin: PLUGIN_KEY, key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
export const sessionAtom = atom({ plugin: PLUGIN_KEY, key: 'session' } as const, null, { shape: STATE_SHAPES.session })
export const historyAtom = atom({ plugin: PLUGIN_KEY, key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
export const bandEnabledAtom = atom({ plugin: PLUGIN_KEY, key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })
