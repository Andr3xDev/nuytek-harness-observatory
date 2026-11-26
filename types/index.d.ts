export type PanelTab = 1 | 2 | 3 | 4

// The validator requires this contract to be self-contained (no import), so the
// aggregate shapes cannot be named here. They are opaque objects at the atom
// boundary; panel/ narrows them to SessionFigures / AggregateFigures at the seam.
export type SessionAtom = {
  sessionFigures: object
  aggregate: object
  liveAgentIds: string[]
  /** The agent the session itself runs as (`--agent`); absent or null when it runs as none. */
  mainAgent?: string | null
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
      tick: Shaped<number>
      session: Shaped<SessionAtom | null>
      history: Shaped<HistoryAtom>
      panelOpen: Shaped<boolean>
    }
  }
}
