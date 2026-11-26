import type { On } from 'claude-code'
import type { AgentFigures, AggregateFigures, Figure, SessionFigures, ToolFigures } from '../../report/analysis'
import type { HistoryAtom, PanelScope, PanelTab, SessionAtom } from '../../../types'
import type { TabContext } from './common'

export const PLUGIN = 'nuytek-harness-observatory'
export const SURFACE = 'terminal'

export const figure = (tokens: number, costUsd = 0, hasUnknownPrice = false): Figure => ({
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  tokens,
  costUsd,
  hasUnknownPrice,
})

export const agent = (agentId: string, overrides: Partial<AgentFigures> = {}): AgentFigures => ({
  ...figure(1000, 0.1),
  agentId,
  parentAgentId: null,
  subagentType: 'builder',
  engineStatus: 'completed',
  durationMs: 65_000,
  ...overrides,
})

export const emptyTools = (): ToolFigures => ({
  skills: {},
  mcp: {},
  commands: {},
  bash: {},
  verdicts: {},
  denyReasons: {},
  outcomes: {},
  bashPromptHook: null,
})

export const aggregate = (overrides: Partial<AggregateFigures> = {}): AggregateFigures => ({
  sessions: 1,
  openSessions: 1,
  windowStart: 1_700_000_000_000,
  windowEnd: 1_700_100_000_000,
  total: figure(5000, 0.5),
  cacheRatio: null,
  byType: [],
  byTypeModel: [],
  byModel: [],
  byIssue: [],
  engineStatusMix: {},
  denies: 0,
  tools: emptyTools(),
  profile: null,
  ...overrides,
})

export const profile = (overrides: Partial<NonNullable<AggregateFigures['profile']>> = {}): NonNullable<AggregateFigures['profile']> => ({
  statusMixByType: {},
  reroutesByType: {},
  reviewPasses: 0,
  skillsInjected: {},
  guards: {},
  coverage: { profileSessions: 1, sessions: 1 },
  ...overrides,
})

export const sessionFigures = (agents: AgentFigures[] = [], overrides: Partial<SessionFigures> = {}): SessionFigures =>
  ({
    sessionId: 's1',
    state: 'open',
    harnessProfile: false,
    startedAt: 1,
    endedAt: null,
    total: figure(5000, 0.5),
    main: figure(2000, 0.2),
    byType: {},
    byModel: { m1: { input: 3000, output: 0, cacheRead: 0, cacheCreation: 0, tokens: 3000 } },
    byIssue: {},
    trees: [],
    agents,
    tools: emptyTools(),
    denies: 0,
    profile: null,
    coverage: { agentsWithoutSnapshot: 0, mainCostGapUsd: 0, skippedNewerSchema: 0 },
    ...overrides,
  }) satisfies SessionFigures

export const sessionAtomValue = (figures: SessionFigures, aggregateFigures: AggregateFigures, liveAgentIds: string[] = []): SessionAtom => ({
  sessionFigures: figures,
  aggregate: aggregateFigures,
  liveAgentIds,
  loadedAt: 1,
  error: null,
})

export const WIDTHS = { wide: 100, medium: 60, narrow: 40 } as const

export const context = (tier: keyof typeof WIDTHS, overrides: Partial<TabContext> = {}): TabContext => ({
  tier,
  columns: WIDTHS[tier],
  scope: 'session',
  session: null,
  history: { status: 'idle' },
  ...overrides,
})

export const textOf = (lines: ReadonlyArray<{ text: string }>): string => lines.map(line => line.text).join('\n')

export const bandTarget = (bodyColumns: number, hasSurvey = false) =>
  ({
    plugin: PLUGIN,
    surface: SURFACE,
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 20,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 20 },
      view: {},
    },
  }) as const

type Seed = {
  tab?: PanelTab
  scope?: PanelScope
  session?: SessionAtom | null
  history?: HistoryAtom
  panelOpen?: boolean
}

/**
 * Seeds atoms the test `$` cannot write (it has no `state` noun): a key the kit's own state holds
 * nothing for reads as `seed`, under the atom's shape tag. Writes go through to the kit, so a
 * press redraws the band; `written` records them for the test to read back.
 */
export function installState(on: On, seed: Seed = {}) {
  const shapes: Record<string, string> = { tab: 'tab-1', scope: 'scope-1', tick: 'tick-1', session: 'session-1', history: 'history-1', panelOpen: 'open-1' }
  const written: Record<string, unknown> = {}
  on('state.get', async (_, e, next) => {
    const stored = await next(e)
    const seeded = (seed as Record<string, unknown>)[e.key]
    if ((stored.value?.version ?? 0) > 0 || seeded === undefined) return stored
    return { value: { value: { shape: shapes[e.key], value: seeded }, version: 1 } }
  })
  on('state.set', (_, e, next) => {
    written[e.key] = (e.value as { value: unknown }).value
    return next(e)
  })
  return written
}
