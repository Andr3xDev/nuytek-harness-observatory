const SKILL_FILE_NAME = 'SKILL.md'

export const parseSkillNameFromPath = (path: string): string | null => {
  const segments = path.split('/')
  if (segments.pop() !== SKILL_FILE_NAME) return null
  return segments.pop() || null
}
