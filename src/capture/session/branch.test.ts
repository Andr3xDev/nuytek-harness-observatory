import { describe, expect, test } from 'claude-code/testing'
import { GIT_BRANCH_ARGV, createBranchProvider, type GitRunner, type VcsDetect } from './branch'

const CWD = '/work/repo'
const detecting = (...branches: Array<string | null>): VcsDetect => {
  const queue = [...branches]
  return async () => {
    const branch = queue.shift() ?? null
    return branch === null ? null : { branch }
  }
}
const git = (stdout: string, exitCode = 0) => {
  const calls: string[][] = []
  const run: GitRunner = async (argv) => {
    calls.push(argv)
    return { exitCode, stdout }
  }
  return { run, calls }
}
const failingGit: GitRunner = async () => {
  throw new Error('no git')
}

describe('BranchProvider', () => {
  test('uses vcs.detect and does not spawn git when it answers', async () => {
    const { run, calls } = git('unused')
    const provider = createBranchProvider({ detect: detecting('feature/x'), runGit: run })
    expect(await provider.refresh(CWD)).toBe('feature/x')
    expect(calls).toEqual([])
  })

  test('falls back to git rev-parse when detect returns null', async () => {
    const { run, calls } = git('main\n')
    const provider = createBranchProvider({ detect: detecting(null), runGit: run })
    expect(await provider.refresh(CWD)).toBe('main')
    expect(calls).toEqual([GIT_BRANCH_ARGV])
  })

  test('falls back to git when detect rejects', async () => {
    const { run } = git('main\n')
    const provider = createBranchProvider({
      detect: async () => {
        throw new Error('experimental api gone')
      },
      runGit: run,
    })
    expect(await provider.refresh(CWD)).toBe('main')
  })

  test('both sources failing give null', async () => {
    const provider = createBranchProvider({ detect: detecting(null), runGit: failingGit })
    expect(await provider.refresh(CWD)).toBeNull()
  })

  test('a non-zero git exit gives null', async () => {
    const { run } = git('fatal: not a git repository', 128)
    const provider = createBranchProvider({ detect: detecting(null), runGit: run })
    expect(await provider.refresh(CWD)).toBeNull()
  })

  test('a failed git fallback is not respawned for the same cwd but is retried on another', async () => {
    const { run, calls } = git('fatal: not a git repository', 128)
    const provider = createBranchProvider({ detect: detecting(null, null, null), runGit: run })
    await provider.refresh(CWD)
    await provider.refresh(CWD)
    expect(calls).toHaveLength(1)
    await provider.refresh('/work/other')
    expect(calls).toHaveLength(2)
  })

  test('a detached head is stored as the literal HEAD', async () => {
    const { run } = git('HEAD\n')
    const provider = createBranchProvider({ detect: detecting(null), runGit: run })
    expect(await provider.refresh(CWD)).toBe('HEAD')
  })

  test('current serves the cached branch and a re-read picks up a switch', async () => {
    const provider = createBranchProvider({ detect: detecting('a', 'b'), runGit: failingGit })
    expect(provider.current()).toBeNull()
    await provider.refresh(CWD)
    expect(provider.current()).toBe('a')
    await provider.refresh(CWD)
    expect(provider.current()).toBe('b')
  })
})
