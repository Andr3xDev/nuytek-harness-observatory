import type { TokenCounts } from './types'

export const UNATTRIBUTED_ISSUE = 'unattributed'

const ISSUE_SEGMENT = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d{1,6})(?:-|$)/
const UNATTRIBUTED_BRANCHES = new Set(['main', 'master', 'dev', 'HEAD'])

export function issueKeyOf(branch: string | null): string {
  if (branch === null || branch === '' || UNATTRIBUTED_BRANCHES.has(branch)) return UNATTRIBUTED_ISSUE
  for (const segment of branch.split('/')) {
    const match = ISSUE_SEGMENT.exec(segment)
    if (match) return `${match[1]?.toUpperCase()}-${match[2]}`
  }
  return `branch:${branch}`
}

export function cacheRatio(tokens: TokenCounts): number | null {
  const promptTokens = tokens.input + tokens.cacheRead + tokens.cacheCreation
  return promptTokens === 0 ? null : tokens.cacheRead / promptTokens
}
