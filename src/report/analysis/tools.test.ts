import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { CTX, commandRun, skillUse, spawn, verdict } from './test-fixtures'

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

  test('counts slash commands', () => {
    const tools = summarize([commandRun('status'), commandRun('status')])

    expect(tools.commands.status).toBe(2)
  })

  test('groups MCP calls under their server', () => {
    const tools = summarize([verdict('t1', 'allow', { toolName: 'mcp__srv__lookup', mcpServer: 'srv' })])

    expect(Object.keys(tools.mcp)).toEqual(['srv'])
    expect(Object.values(tools.mcp.srv ?? {})).toEqual([1])
  })
})
