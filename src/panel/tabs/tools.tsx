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

const SKILL_COLUMNS: Column[] = [
  { header: 'Skill', width: 0 },
  { header: 'Prompted', width: 8 },
  { header: 'Read', width: 4 },
  { header: 'Invoked', width: 7 },
  { header: 'By agent', width: 36, secondary: true },
]
const MCP_COLUMNS: Column[] = [{ header: 'MCP tool', width: 0 }, { header: 'Calls', width: 5 }]
const COMMAND_COLUMNS: Column[] = [{ header: 'Command', width: 0 }, { header: 'Runs', width: 5 }]
const INJECTED_COLUMNS: Column[] = [{ header: 'Skill injected', width: 0 }, { header: 'Spawns', width: 6 }]

const byCountDesc = (left: [string, number], right: [string, number]): number => right[1] - left[1]

export function toolsLines(ctx: TabContext): Line[] {
  const gate = gateOf(ctx)
  if ('message' in gate) return [dim(gate.message)]
  const { aggregate } = gate
  const { tier, columns } = ctx
  const { tools, profile } = aggregate

  const skills = Object.entries(tools.skills).map(
    ([name, skill]): Row => ({
      cells: [
        name,
        String(skill.prompted),
        String(skill.read),
        String(skill.invoked),
        Object.entries(skill.byAgentType)
          .map(([type, count]) => `${type}: prompted ${count.prompted} read ${count.read} invoked ${count.invoked}`)
          .join('; '),
      ],
    }),
  )
  const mcp = Object.entries(tools.mcp).flatMap(([server, calls]) =>
    Object.entries(calls).map(([tool, count]): Row => ({ cells: [`${server} / ${tool}`, String(count)] })),
  )
  const commands = Object.entries(tools.commands)
    .sort(byCountDesc)
    .map(([name, count]): Row => ({ cells: [`/${name}`, String(count)] }))
  const injected = profile
    ? Object.entries(profile.skillsInjected)
        .sort(byCountDesc)
        .map(([name, count]): Row => ({ cells: [name, String(count)] }))
    : [{ cells: ['(all skills)', 'n/a'] }]

  return [
    heading('Skills'),
    ...tableLines(tier, columns, SKILL_COLUMNS, skills),
    heading('Skills injected'),
    ...tableLines(tier, columns, INJECTED_COLUMNS, injected),
    heading('MCP calls'),
    ...tableLines(tier, columns, MCP_COLUMNS, mcp),
    heading('Slash commands'),
    ...tableLines(tier, columns, COMMAND_COLUMNS, commands),
    ...(profile ? [] : [dim(PROFILE_OFF_FOOTNOTE)]),
  ]
}
