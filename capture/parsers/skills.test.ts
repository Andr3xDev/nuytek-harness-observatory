import { describe, expect, test } from 'claude-code/testing'
import { parseSkillsBlock } from './skills'

describe('parseSkillsBlock', () => {
  test('lists the entries of a SKILLS block', () => {
    const prompt = 'AGENT x\nSKILLS:\n- /a/skills/foo/SKILL.md\n- /a/skills/bar/SKILL.md\n\nOUTPUT: report'
    expect(parseSkillsBlock(prompt)).toEqual(['/a/skills/foo/SKILL.md', '/a/skills/bar/SKILL.md'])
  })

  test('stops at the next non-bullet line', () => {
    const prompt = 'SKILLS:\n- /a/foo/SKILL.md\nOUTPUT: report\n- not-a-skill'
    expect(parseSkillsBlock(prompt)).toEqual(['/a/foo/SKILL.md'])
  })

  test('skips a heading line directly after SKILLS: (real harness format)', () => {
    const prompt = 'SKILLS:\n## Skills to load before work\n- /a/x/SKILL.md\n- /a/y/SKILL.md\nOUTPUT: report'
    expect(parseSkillsBlock(prompt)).toEqual(['/a/x/SKILL.md', '/a/y/SKILL.md'])
  })

  test('returns an empty array when the block is absent', () => {
    expect(parseSkillsBlock('just a prompt')).toEqual([])
  })

  test('returns an empty array for an empty block', () => {
    expect(parseSkillsBlock('SKILLS:\n\nOUTPUT: x')).toEqual([])
  })
})
