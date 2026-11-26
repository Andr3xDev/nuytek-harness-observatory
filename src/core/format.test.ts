import { describe, expect, test } from 'claude-code/testing'
import type { Figure, SessionFigures } from './figures'
import { bandSegments, formatBandLine, formatFigure, formatTokens, formatUsd, isoDay, truncate } from './format'

const figure = (tokens: number, costUsd: number, hasUnknownPrice = false): Figure => ({
  input: tokens,
  output: 0,
  cacheRead: 0,
  cacheCreation: 0,
  tokens,
  costUsd,
  hasUnknownPrice,
})

const agentRows = (count: number): SessionFigures['agents'] =>
  Array.from({ length: count }, (_, index) => ({
    ...figure(0, 0),
    agentId: `a${index}`,
    parentAgentId: null,
    subagentType: 'dev',
    engineStatus: 'completed' as const,
    durationMs: 0,
  }))

const sessionFigures = (total: Figure, agentCount: number): SessionFigures => ({
  sessionId: 's1',
  state: 'open',
  harnessProfile: true,
  startedAt: null,
  endedAt: null,
  total,
  main: total,
  byType: {},
  byModel: {},
  byIssue: {},
  trees: [],
  agents: agentRows(agentCount),
  tools: { skills: {}, mcp: {}, commands: {}, bash: {}, verdicts: {}, denyReasons: {}, outcomes: {}, bashPromptHook: null },
  denies: 0,
  profile: null,
  coverage: { agentsWithoutSnapshot: 0, mainCostGapUsd: 0, skippedNewerSchema: 0 },
})

describe('formatTokens', () => {
  const cases: [number, string][] = [
    [0, '0'],
    [999, '999'],
    [1000, '1.0k'],
    [9900, '9.9k'],
    [10_000, '10k'],
    [412_000, '412k'],
    [1_200_000, '1.2M'],
  ]
  for (const [tokens, label] of cases) {
    test(`renders ${tokens} as ${label}`, () => {
      expect(formatTokens(tokens)).toBe(label)
    })
  }
})

describe('truncate', () => {
  test('cuts at the end with an ellipsis and fills the width', () => {
    expect(truncate('infra-agent-bash-guard', 10)).toBe('infra-age…')
  })

  test('leaves text that fits untouched', () => {
    expect(truncate('short', 10)).toBe('short')
  })
})

describe('isoDay', () => {
  test('renders the UTC calendar day', () => {
    expect(isoDay(Date.UTC(2026, 10, 25, 23, 59))).toBe('2026-11-25')
  })
})

describe('formatUsd', () => {
  test('renders two decimals', () => {
    expect(formatUsd(2.41)).toBe('$2.41')
    expect(formatUsd(0)).toBe('$0.00')
  })
})

describe('formatFigure', () => {
  test('null is the long profile-off wording in scalar mode', () => {
    expect(formatFigure(null, 'scalar')).toBe('n/a (harness profile off)')
  })

  test('null is bare n/a in cell mode', () => {
    expect(formatFigure(null, 'cell')).toBe('n/a')
  })

  test('a real zero renders 0 in both modes, never n/a', () => {
    expect(formatFigure(0, 'scalar')).toBe('0')
    expect(formatFigure(0, 'cell')).toBe('0')
  })
})

describe('formatBandLine', () => {
  test('renders cost, tokens and agent count', () => {
    expect(formatBandLine(sessionFigures(figure(412_000, 2.41), 4))).toBe('◆ obs  $2.41 · ◈ 412k tok · ▸ 4 agents')
  })

  test('marks the cost as an estimate when the price is unknown', () => {
    expect(formatBandLine(sessionFigures(figure(412_000, 2.41, true), 4))).toBe('◆ obs  ~$2.41 · ◈ 412k tok · ▸ 4 agents')
  })

  test('uses the singular for one agent', () => {
    expect(formatBandLine(sessionFigures(figure(1000, 0.1), 1))).toContain('1 agent')
    expect(formatBandLine(sessionFigures(figure(1000, 0.1), 1))).not.toContain('1 agents')
  })

  test('shows zeros before the first data', () => {
    expect(formatBandLine(sessionFigures(figure(0, 0), 0))).toBe('◆ obs  $0.00 · ◈ 0 tok · ▸ 0 agents')
  })

  test('segments tag the icons and the cost by role, the values stay plain', () => {
    const roles = bandSegments(sessionFigures(figure(1000, 0.1), 1)).filter(({ role }) => role !== 'plain' && role !== 'dim')
    expect(roles).toEqual([
      { text: '◆', role: 'brand' },
      { text: '$0.10', role: 'cost' },
      { text: '◈', role: 'tokens' },
      { text: '▸', role: 'agents' },
    ])
  })
})
