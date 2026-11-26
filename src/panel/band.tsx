import { atom, read, update } from 'claude-code'
import type { Color, On } from 'claude-code'
import type { PanelScope, PanelTab } from '../../types'
import { bandSegments, type BandRole } from '../core/format'
import { emptyFigure, type SessionFigures } from '../core/figures'
import { PALETTE, SECTION_RULE, TAB_LABELS, tierOf } from './layout'
import { STATE_SHAPES } from './state'
import { renderLines, type Line, type TabContext } from './tabs/common'
import { agentsLines } from './tabs/agents'
import { historyLines } from './tabs/history'
import { permissionsLines } from './tabs/permissions'
import { sessionLines } from './tabs/session'
import { toolsLines } from './tabs/tools'

const TABS: readonly PanelTab[] = [1, 2, 3, 4, 5]
const HISTORY_TAB: PanelTab = 5
const BAND_ROLE_COLORS: Record<BandRole, Color | undefined> = {
  brand: PALETTE.brand,
  cost: PALETTE.cost,
  tokens: PALETTE.tokens,
  agents: PALETTE.agents,
  plain: undefined,
  dim: undefined,
}

// The hooks scan reads state refs only from literals or atoms declared in the reading file, so the
// panel atoms are declared in each file that reads them (same keys, shape tags from panel/state.ts).
const tabAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tab' } as const, 1, { shape: STATE_SHAPES.tab })
const scopeAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'scope' } as const, 'session', { shape: STATE_SHAPES.scope })
const tickAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'tick' } as const, 0, { shape: STATE_SHAPES.tick })
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const historyAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'history' } as const, { status: 'idle' }, { shape: STATE_SHAPES.history })
const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })
const panelOpenAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'panelOpen' } as const, false, { shape: STATE_SHAPES.panelOpen })

const TAB_LINES: Record<PanelTab, (ctx: TabContext) => Line[]> = {
  1: sessionLines,
  2: agentsLines,
  3: toolsLines,
  4: permissionsLines,
  5: historyLines,
}

export type BandDeps = {
  /** Starts (or reuses) the history load; called from press handlers only, never while drawing. */
  ensureHistory: () => void
}

export function registerBand(on: On, deps: BandDeps) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // `tick` is read only to subscribe: the open-panel timer redraws the band through it.
    const [enabled, isOpen, tab, scope, session, history] = await Promise.all([
      read($, bandEnabledAtom),
      read($, panelOpenAtom),
      read($, tabAtom),
      read($, scopeAtom),
      read($, sessionAtom),
      read($, historyAtom),
      read($, tickAtom),
    ])
    if (!enabled || e.props.hasSurvey) return next(e)
    const { Box, Text, Button } = $.ui.resolve(e)

    if (!isOpen) {
      const figures = session ? (session.sessionFigures as SessionFigures) : { total: emptyFigure(), agents: [] }
      return (
        <Text wrap="truncate-end">
          {bandSegments(figures).map((segment, index) => (
            <Text key={`segment:${index}`} color={BAND_ROLE_COLORS[segment.role]} dimColor={segment.role === 'dim'}>
              {segment.text}
            </Text>
          ))}
        </Text>
      )
    }

    const { bodyColumns } = e.props
    const ctx: TabContext = { tier: tierOf(bodyColumns), columns: bodyColumns, scope, session, history }

    const selectTab = async (target: PanelTab) => {
      await update($, tabAtom, () => target)
      if (target === HISTORY_TAB || scope === 'history') deps.ensureHistory()
    }
    const toggleScope = async () => {
      const target: PanelScope = scope === 'session' ? 'history' : 'session'
      await update($, scopeAtom, () => target)
      if (target === 'history') deps.ensureHistory()
    }
    const viewAgent = async (agentId: string) => {
      const result = await $.ui.view({ agentId })
      if (result.deny) $.ui.toast(result.deny)
    }

    return (
      <Box flexDirection="column">
        <Box flexWrap="wrap" columnGap={1}>
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
          {tab !== HISTORY_TAB && (
            <Button key="scope" plain onPress={toggleScope}>
              [<Text bold={scope === 'session'} color={scope === 'session' ? PALETTE.brand : undefined} dimColor={scope !== 'session'}>Session</Text> ⇄{' '}
              <Text bold={scope === 'history'} color={scope === 'history' ? PALETTE.brand : undefined} dimColor={scope !== 'history'}>History</Text>]
            </Button>
          )}
        </Box>
        <Text dimColor wrap="truncate-end">
          {SECTION_RULE.repeat(bodyColumns)}
        </Text>
        {session?.error && scope === 'session' && <Text color={PALETTE.failure}>stale: {session.error}</Text>}
        {renderLines({ Box, Text, Button }, TAB_LINES[tab](ctx), session?.liveAgentIds ?? [], viewAgent, bodyColumns)}
      </Box>
    )
  })
}
