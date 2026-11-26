export const GIT_BRANCH_ARGV = ['git', 'rev-parse', '--abbrev-ref', 'HEAD']

export type VcsDetect = (cwd: string) => Promise<{ branch: string } | null>
export type GitRunner = (argv: string[]) => Promise<{ exitCode: number; stdout: string }>

export type BranchProvider = {
  refresh: (cwd: string) => Promise<string | null>
  current: () => string | null
}

export const createBranchProvider = (deps: { detect: VcsDetect; runGit: GitRunner }): BranchProvider => {
  let cached: string | null = null

  const fromDetect = async (cwd: string): Promise<string | null> => {
    try {
      return (await deps.detect(cwd))?.branch ?? null
    } catch {
      return null
    }
  }

  const fromGit = async (): Promise<string | null> => {
    try {
      const result = await deps.runGit(GIT_BRANCH_ARGV)
      return result.exitCode === 0 ? result.stdout.trim() || null : null
    } catch {
      return null
    }
  }

  return {
    current: () => cached,
    refresh: async (cwd) => {
      cached = (await fromDetect(cwd)) ?? (await fromGit())
      return cached
    },
  }
}
