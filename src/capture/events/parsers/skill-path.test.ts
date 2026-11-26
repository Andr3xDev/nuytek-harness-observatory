import { describe, expect, test } from 'claude-code/testing'
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
