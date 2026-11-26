import { atom, read, update } from 'claude-code'
import type { On } from 'claude-code'
import type { PanelTab } from '../../types'
import { BOX_CHROME_COLUMNS, PALETTE, SECTION_RULE, TAB_LABELS, tierOf } from './layout'
import { STATE_SHAPES } from './state'
import { renderLines, type Line, type TabContext } from './tabs/common'
import { agentsLines } from './tabs/agents'
import { historyLines } from './tabs/history'
import { sessionLines } from './tabs/session'
import { toolsLines } from './tabs/tools'

const TABS: readonly PanelTab[] = [1, 2, 3, 4]
const HISTORY_TAB: PanelTab = 4

// The hooks scan reads state refs only from literals or atoms declared in the reading file, so the
// panel atoms are declared in each file that reads them (same keys, shape tags from panel/state.ts).
const tabAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tab' } as const, 1, { shape: STATE_SHAPES.tab })
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
const panelOpenAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'panelOpen' } as const, false, { shape: STATE_SHAPES.panelOpen })

const TAB_LINES: Record<PanelTab, (ctx: TabContext) => Line[]> = {
  1: sessionLines,
  2: agentsLines,
  3: toolsLines,
  4: historyLines,
}

export type BandDeps = {
  /** Starts (or reuses) the history load; called from press handlers only, never while drawing. */
  ensureHistory: () => void
}

export function registerBand(on: On, deps: BandDeps) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // `tick` is read only to subscribe: the open-panel timer redraws the band through it.
    const [isOpen, storedTab, session, history] = await Promise.all([
      read($, panelOpenAtom),
      read($, tabAtom),
      read($, sessionAtom),
      read($, historyAtom),
      read($, tickAtom),
    ])
    if (!isOpen || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    // A tab number stored before a tab was removed falls back to Session.
    const tab: PanelTab = TABS.includes(storedTab) ? storedTab : 1
    const columns = Math.max(e.props.bodyColumns - BOX_CHROME_COLUMNS, 1)
    const ctx: TabContext = { tier: tierOf(columns), columns, session, history }

    const selectTab = async (target: PanelTab) => {
      await update($, tabAtom, () => target)
      if (target === HISTORY_TAB) deps.ensureHistory()
    }
    const viewAgent = async (agentId: string) => {
      const result = await $.ui.view({ agentId })
      if (result.deny) $.ui.toast(result.deny)
    }

    return (
      <Box flexDirection="column" borderStyle="round" borderColor={PALETTE.border} paddingX={1}>
        <Box flexWrap="wrap" justifyContent="space-between" columnGap={1}>
          <Box flexWrap="wrap" columnGap={1}>
            <Text bold color={PALETTE.brand}>
              ◆ obs
            </Text>
            {TABS.map(number => (
              <Button key={`tab:${number}`} plain hotkey={String(number)} dimColor={tab !== number} onPress={() => selectTab(number)}>
                {tab === number ? (
                  <Text bold underline color={PALETTE.brand}>
                    {TAB_LABELS[number - 1]}
                  </Text>
                ) : (
                  TAB_LABELS[number - 1]
                )}
              </Button>
            ))}
          </Box>
        </Box>
        <Text dimColor wrap="truncate-end">
          {SECTION_RULE.repeat(columns)}
        </Text>
        {session?.error && tab !== HISTORY_TAB &&<Text color={PALETTE.failure}>stale: {session.error}</Text>}
        {renderLines({ Box, Text, Button }, TAB_LINES[tab](ctx), session?.liveAgentIds ?? [], viewAgent, columns)}
      </Box>
    )
  })
}
