import { sessionLines } from './session'
import type { Line, TabContext } from './common'

// Tab 5 is the tab-1 History layout; the scope is forced because tab 5 has no scope toggle.
export const historyLines = (ctx: TabContext): Line[] => sessionLines({ ...ctx, scope: 'history' })
