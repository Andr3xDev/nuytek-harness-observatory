export const STATE_SHAPES = {
  tab: 'tab-1',
  tick: 'tick-1',
  session: 'session-5',
  history: 'history-4',
  panelOpen: 'open-1',
} as const

/** `$.store` key of the persisted open flag; read by the band and written by `/obs`. */
export const PANEL_OPEN_STORE_KEY = 'panelOpen'

let storedOpen: { sessionId: string; open: boolean } | undefined

/**
 * The one "is the panel open" rule of the band and `/obs`. Atoms are per session, so after a resume the atom is
 * back to false while the store keeps the user's choice; the store is read once per session, not per render.
 */
export async function isPanelOpen(atomOpen: boolean, sessionId: string, readStored: () => Promise<boolean>): Promise<boolean> {
  if (atomOpen) return true
  if (storedOpen?.sessionId === sessionId) return storedOpen.open
  let open: boolean
  try {
    open = await readStored()
  } catch {
    return false
  }
  storedOpen = { sessionId, open }
  return open
}

/** Keeps the per-session memo in step with what `/obs` persisted. */
export function rememberPanelOpen(sessionId: string, open: boolean): void {
  storedOpen = { sessionId, open }
}

/** Drops the memo; tests share this module state across cases. */
export function forgetPanelOpen(): void {
  storedOpen = undefined
}
