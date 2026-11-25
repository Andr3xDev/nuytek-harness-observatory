import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'
import type { PanelScope, PanelTab } from '../types'
import { STATE_SHAPES } from './state'
import { tabLabels, tierOf } from './layout'
import { renderLines, type Line, type TabContext } from './tabs/common'
import { agentsLines } from './tabs/agents'
import { historyLines } from './tabs/history'
import { permissionsLines } from './tabs/permissions'
import { sessionLines } from './tabs/session'
import { toolsLines } from './tabs/tools'

export const PANE_ID = 'observatory'
const TABS: readonly PanelTab[] = [1, 2, 3, 4, 5]
const HISTORY_TAB: PanelTab = 5
const UNFOCUSED_HINT = 'click a tab, or ctrl+x tab, to use keys 1-5'

// The hooks scan reads state refs only from literals or atoms declared in the reading file, so the
// atoms of ui/state.ts are redeclared here (same keys and shape tags) instead of imported.
const tabAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tab' } as const, 1, { shape: STATE_SHAPES.tab })
const scopeAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })

const TAB_LINES: Record<PanelTab, (ctx: TabContext) => Line[]> = {
  1: sessionLines,
  2: agentsLines,
  3: toolsLines,
  4: permissionsLines,
  5: historyLines,
}

export type PaneDeps = {
  /** Starts (or reuses) the history load; called from press handlers only, never while drawing. */
  ensureHistory: () => void
}

export function registerPane(on: On, deps: PaneDeps) {
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    // `tick` is read only to subscribe: the 5 s timer redraws the pane through it.
    const [tab, scope, session, history] = await Promise.all([
      read($, tabAtom),
      read($, scopeAtom),
      read($, sessionAtom),
      read($, historyAtom),
      read($, tickAtom),
    ])
    const { Box, Text, Button } = $.ui.resolve(e)
    const { bodyColumns, isFocused } = e.props
    const tier = tierOf(bodyColumns)
    const isHistoryTab = tab === HISTORY_TAB
    const ctx: TabContext = { tier, columns: bodyColumns, scope, session, history }

    const selectTab = async (next: PanelTab) => {
      await update($, tabAtom, () => next)
      if (next === HISTORY_TAB || scope === 'history') deps.ensureHistory()
    }
    const toggleScope = async () => {
      const next: PanelScope = scope === 'session' ? 'history' : 'session'
      await update($, scopeAtom, () => next)
      if (next === 'history') deps.ensureHistory()
    }
    const viewAgent = async (agentId: string) => {
      const result = await $.ui.view({ agentId })
      if (result.deny) $.ui.toast(result.deny)
    }

    const labels = tabLabels(tier)
    return (
      <Box flexDirection="column">
        <Box columnGap={1}>
          <Text bold>Observatory</Text>
          <Button key="hide" plain onPress={() => $.ui.close({ id: PANE_ID })}>
            [✕ Hide]
          </Button>
        </Box>
        <Box flexWrap={tier === 'narrow' ? 'wrap' : 'nowrap'} columnGap={1}>
          {TABS.map(number => (
            <Button key={`tab:${number}`} plain hotkey={String(number)} dimColor={tab !== number} onPress={() => selectTab(number)}>
              {labels[number - 1]}
            </Button>
          ))}
        </Box>
        {!isFocused && <Text dimColor>{UNFOCUSED_HINT}</Text>}
        {!isHistoryTab && (
          <Button key="scope" plain onPress={toggleScope}>
            [<Text dimColor={scope !== 'session'}>Session</Text> ⇄ <Text dimColor={scope !== 'history'}>History</Text>]
          </Button>
        )}
        {session?.error && scope === 'session' && <Text dimColor>stale: {session.error}</Text>}
        {renderLines({ Box, Text, Button }, TAB_LINES[tab](ctx), session?.liveAgentIds ?? [], viewAgent)}
      </Box>
    )
  })
}
