const BLOCK_START = 'SKILLS:'
const BULLET = '- '
const HEADING = '#'

/** Reads the bullets after `SKILLS:`, skipping blank lines and one `#` heading line. */
export const parseSkillsBlock = (prompt: string): string[] => {
  const lines = prompt.split('\n').map((line) => line.trim())
  let index = lines.indexOf(BLOCK_START) + 1
  if (index === 0) return []
  const skipBlanks = (): void => {
    while (index < lines.length && lines[index] === '') index++
  }
  skipBlanks()
  if (lines[index]?.startsWith(HEADING)) {
    index++
    skipBlanks()
  }
  const skills: string[] = []
  for (let line = lines[index]; line?.startsWith(BULLET); line = lines[++index]) skills.push(line.slice(BULLET.length).trim())
  return skills
}
