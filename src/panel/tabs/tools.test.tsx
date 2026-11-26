import { describe, expect, test } from 'claude-code/testing'
import type { ToolFigures } from '../../core/figures'
import { toolsLines } from './tools'
import { aggregate, context, emptyTools, profile, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const withTools = (tools: Partial<ToolFigures>, withProfile = true) =>
  sessionAtomValue(sessionFigures(), aggregate({ tools: { ...emptyTools(), ...tools }, profile: withProfile ? profile() : null }))

describe('tools tab', () => {
  test('a read skill is attributed to the agent type that read it', () => {
    const session = withTools({
      skills: { foo: { prompted: 2, read: 1, invoked: 0, byAgentType: { builder: { prompted: 0, read: 1, invoked: 0 } } } },
    })
    const text = textOf(toolsLines(context('wide', { session })))
    expect(text).toMatch(/^foo .*2 .*1 .*0 .*builder: prompted 0 read 1 invoked 0/m)
  })

  test('25 skills render 20 rows plus +5 more', () => {
    const skills = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`skill-${index}`, { prompted: 0, read: 1, invoked: 0, byAgentType: {} }]))
    const lines = toolsLines(context('wide', { session: withTools({ skills }) }))
    const rows = lines.filter((line) => line.text.startsWith('skill-'))
    expect(rows).toHaveLength(20)
    expect(lines.filter((line) => line.text ==='+5 more')).toHaveLength(1)
  })

  test('MCP calls group by server and tool; commands show with a slash', () => {
    const text = textOf(toolsLines(context('wide', { session: withTools({ mcp: { linear: { get_issue: 3 } }, commands: { obs: 2 } }) })))
    expect(text).toMatch(/^linear \/ get_issue .*3$/m)
    expect(text).toMatch(/^\/obs .*2$/m)
  })

  test('rows sort by use count before the cap, so a late heavy skill and MCP tool show', () => {
    const skills = Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`skill-${index}`, { prompted: 0, read: 1, invoked: 0, byAgentType: {} }]))
    skills['skill-heavy'] = { prompted: 5, read: 5, invoked: 5, byAgentType: {} }
    const mcp = { srv: Object.fromEntries(Array.from({ length: 25 }, (_, index) => [`tool-${index}`, 1])) }
    mcp.srv['tool-heavy'] = 9
    const lines = toolsLines(context('wide', { session: withTools({ skills, mcp }) }))

    expect(lines.findIndex((line) => line.text.startsWith('skill-heavy'))).toBeLessThan(lines.findIndex((line) => line.text.startsWith('skill-0')))
    expect(lines.some((line) => line.text.startsWith('srv / tool-heavy'))).toBe(true)
  })

  test('a null profile marks injected skills n/a with one footnote', () => {
    const text = textOf(toolsLines(context('wide', { session: withTools({}, false) })))
    expect(text).toContain('n/a')
    expect(text.match(/n\/a: harness profile off/g)).toHaveLength(1)
  })
})
