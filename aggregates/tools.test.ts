import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { MAX_COMMAND_CHARS, ROLLUP_MAX_BASH_COMMANDS } from './types'
import { CTX, commandRun, permissionOutcome, skillUse, spawn, verdict } from './test-fixtures'

const summarize = (events: Parameters<typeof summarizeSession>[0]['events']) => summarizeSession({ events, snapshots: [] }, CTX).tools

describe('summarizeSession tools', () => {
  test('attributes a skill read twice by builder agents to builder', () => {
    const tools = summarize([spawn('a1'), skillUse('foo', 'read', 'a1'), skillUse('foo', 'read', 'a1')])

    expect(tools.skills.foo?.read).toBe(2)
    expect(tools.skills.foo?.byAgentType.builder).toMatchObject({ read: 2, invoked: 0 })
  })

  test('counts a prompted skill separately from read and invoked', () => {
    const tools = summarize([skillUse('foo', 'prompted'), skillUse('foo', 'invoked')])

    expect(tools.skills.foo).toMatchObject({ prompted: 1, read: 0, invoked: 1 })
    expect(tools.skills.foo?.byAgentType.main).toMatchObject({ prompted: 1, invoked: 1 })
  })

  test('counts allow, ask and deny per agent type by distinct toolUseId, with main for the main loop', () => {
    const tools = summarize([
      spawn('a1'),
      verdict('t1', 'allow', { agentId: 'a1' }),
      verdict('t2', 'deny', { agentId: 'a1' }),
      verdict('t2', 'deny', { agentId: 'a1' }),
      verdict('t3', 'ask'),
    ])

    expect(tools.verdicts.builder).toEqual({ allow: 1, ask: 0, deny: 1 })
    expect(tools.verdicts.main).toEqual({ allow: 0, ask: 1, deny: 0 })
  })

  test('counts deny reasons, slash commands and permission outcomes', () => {
    const tools = summarize([
      verdict('t1', 'deny', { reason: 'no rm' }),
      verdict('t2', 'deny', { reason: 'no rm' }),
      commandRun('status'),
      commandRun('status'),
      permissionOutcome('prompted'),
    ])

    expect(tools.denyReasons['no rm']).toBe(2)
    expect(tools.commands.status).toBe(2)
    expect(tools.outcomes).toEqual({ prompted: 1 })
  })

  test('reports empty outcomes when no permission.outcome exists', () => {
    expect(summarize([verdict('t1', 'allow')]).outcomes).toEqual({})
  })

  test('groups MCP calls under their server', () => {
    const tools = summarize([verdict('t1', 'allow', { toolName: 'mcp__srv__lookup', mcpServer: 'srv' })])

    expect(Object.keys(tools.mcp)).toEqual(['srv'])
    expect(Object.values(tools.mcp.srv ?? {})).toEqual([1])
  })

  test('keeps only the most frequent Bash commands up to the cap', () => {
    const distinct = ROLLUP_MAX_BASH_COMMANDS + 10
    const events = Array.from({ length: distinct }, (_, index) =>
      Array.from({ length: distinct - index }, (_, call) => verdict(`t-${index}-${call}`, 'allow', { command: `cmd${index}` })),
    ).flat()

    const bash = summarize(events).bash

    expect(Object.keys(bash)).toHaveLength(ROLLUP_MAX_BASH_COMMANDS)
    expect(bash.cmd0).toBe(distinct)
    expect(bash[`cmd${distinct - 1}`]).toBeUndefined()
  })

  test('counts a command named like an Object.prototype key', () => {
    const bash = summarize([verdict('t1', 'allow', { command: 'constructor' }), verdict('t2', 'allow', { command: 'constructor' })]).bash

    expect(bash.constructor).toBe(2)
  })

  test('cuts a Bash command text at the character cap', () => {
    const bash = summarize([verdict('t1', 'allow', { command: 'x'.repeat(MAX_COMMAND_CHARS + 100) })]).bash

    expect(Object.keys(bash)[0]).toHaveLength(MAX_COMMAND_CHARS)
  })
})
