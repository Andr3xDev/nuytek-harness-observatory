// The validator requires this contract to be self-contained (no import), so the
// aggregate shapes cannot be named here. They are opaque objects at the atom
// boundary; ui/ narrows them to SessionFigures / AggregateFigures at the seam.
export type PanelTab = 1 | 2 | 3 | 4 | 5
export type PanelScope = 'session' | 'history'

export type SessionAtom = {
  sessionFigures: object
  aggregate: object
  liveAgentIds: string[]
  loadedAt: number
  error: string | null
}

export type HistoryAtom = {
  status: 'idle' | 'loading' | 'ready' | 'unavailable'
  aggregate?: object
  loadedAt?: number
  reason?: string
}

declare module 'claude-code' {
  interface PluginState {
    'nuytek-harness-observatory': {
      tab: Shaped<PanelTab>
      scope: Shaped<PanelScope>
      tick: Shaped<number>
      session: Shaped<SessionAtom | null>
      history: Shaped<HistoryAtom>
      bandEnabled: Shaped<boolean>
    }
  }
}
