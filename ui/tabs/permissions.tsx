import { formatFigure, formatUsd } from '../format'
import {
  PROFILE_OFF_FOOTNOTE,
  dim,
  gateOf,
  heading,
  tableLines,
  type Column,
  type Line,
  type Row,
  type TabContext,
} from './common'

const VERDICT_COLUMNS: Column[] = [
  { header: 'Agent', width: 0 },
  { header: 'Allow', width: 5 },
  { header: 'Ask', width: 5 },
  { header: 'Deny', width: 5 },
]
const REASON_COLUMNS: Column[] = [{ header: 'Deny reason', width: 0 }, { header: 'Count', width: 5 }]
const GUARD_COLUMNS: Column[] = [{ header: 'Guard', width: 0 }, { header: 'Count', width: 5 }]
const OUTCOME_COLUMNS: Column[] = [{ header: 'Prompt outcome', width: 0 }, { header: 'Count', width: 5 }]

const countRows = (counts: Record<string, number>): Row[] =>
  Object.entries(counts)
    .sort(([, left], [, right]) => right - left)
    .map(([name, count]) => ({ cells: [name, String(count)] }))

export function permissionsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { tools, profile } = gate.aggregate
  const { tier, columns } = ctx

  const verdicts = Object.entries(tools.verdicts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, count]): Row => ({ cells: [name, String(count.allow), String(count.ask), String(count.deny)] }))
  const guards = profile ? countRows(profile.guards) : [{ cells: ['(all guards)', formatFigure(null, 'cell')] }]
  const { bashPromptHook } = tools
  const hookFigure =
    bashPromptHook === null
      ? formatFigure(null, 'scalar')
      : `${bashPromptHook.calls} calls · ${bashPromptHook.usd === null ? 'cost not calibrated' : formatUsd(bashPromptHook.usd)}`

  return [
    heading('Verdicts'),
    ...tableLines(tier, columns, VERDICT_COLUMNS, verdicts),
    heading('Deny reasons'),
    ...tableLines(tier, columns, REASON_COLUMNS, countRows(tools.denyReasons)),
    heading('Guards'),
    ...tableLines(tier, columns, GUARD_COLUMNS, guards),
    ...(Object.keys(tools.outcomes).length > 0
      ? [heading('Permission prompts'), ...tableLines(tier, columns, OUTCOME_COLUMNS, countRows(tools.outcomes))]
      : []),
    { text: `Bash prompt hook (estimated): ${hookFigure}` },
    ...(profile ? [] : [dim(PROFILE_OFF_FOOTNOTE)]),
  ]
}
