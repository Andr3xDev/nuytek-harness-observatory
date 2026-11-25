import { describe, expect, test } from 'claude-code/testing'
import { parseMcpServer } from './mcp'
import { parseSkillNameFromPath } from './skill-path'

describe('parseSkillNameFromPath', () => {
  const cases: ReadonlyArray<readonly [string, string, string | null]> = [
    ['absolute skill path', '/home/u/.claude/skills/foo/SKILL.md', 'foo'],
    ['relative skill path', 'skills/bar-baz/SKILL.md', 'bar-baz'],
    ['other markdown file', '/home/u/skills/foo/README.md', null],
    ['SKILL.md with no parent directory', 'SKILL.md', null],
    ['name only ends with SKILL.md', '/a/b/NOT-SKILL.md', null],
  ]

  for (const [name, path, expected] of cases) {
    test(name, () => {
      expect(parseSkillNameFromPath(path)).toBe(expected)
    })
  }
})

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
