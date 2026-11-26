import type { SessionEstimates } from '../../core/schema'

/** Uncalibrated until the manual calibration of design D11 is run. */
export const BASH_PROMPT_HOOK_COST_USD_PER_CALL: number | null = null

const BASH_TOOL = 'Bash'

export type BashCallTracker = {
  recordVerdict: (toolName: string, toolUseId: string) => void
  estimate: (perCallUsd?: number | null) => SessionEstimates | undefined
}

export const createBashCallTracker = (profile: boolean): BashCallTracker => {
  const toolUseIds = new Set<string>()
  return {
    recordVerdict: (toolName, toolUseId) => {
      if (profile && toolName === BASH_TOOL) toolUseIds.add(toolUseId)
    },
    estimate: (perCallUsd = BASH_PROMPT_HOOK_COST_USD_PER_CALL) => {
      if (!profile) return undefined
      const calls = toolUseIds.size
      return {
        bashPromptHook:
          perCallUsd === null
            ? { label: 'estimated', calls }
            : { label: 'estimated', calls, perCallUsd, usd: calls * perCallUsd },
      }
    },
  }
}
