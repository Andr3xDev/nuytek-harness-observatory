import { describe, expect, test } from 'claude-code/testing'
import { parseMcpServer } from './mcp'

describe('parseMcpServer', () => {
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ['plain server', 'mcp__engram__mem_save', 'engram'],
    ['server with single underscore', 'mcp__claude_ai_Docs__read', 'claude_ai_Docs'],
    ['server with hyphen', 'mcp__linear-server__list_issues', 'linear-server'],
    ['built-in tool', 'Bash', null],
    ['prefix without tool part', 'mcp__engram', null],
  ]

  for (const [name, tool, expected] of cases) {
    test(name, () => {
      expect(parseMcpServer(tool)).toBe(expected)
    })
  }
})
