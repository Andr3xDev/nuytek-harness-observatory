import type { UsageRecord } from '../../core/schema'

/**
 * The model an agent ran on. Auto mode bills small classifier calls on another model and they land
 * last in `usage`, so the last entry is not the agent's model: take the recorded one, else the entry
 * that produced the most output.
 */
export const modelOf = (usage: readonly Pick<UsageRecord, 'model' | 'output'>[], recorded?: string): string | null => {
  if (recorded) return recorded
  let best: (typeof usage)[number] | undefined
  for (const entry of usage) if (entry.model && (best === undefined || entry.output > best.output)) best = entry
  return best?.model ?? null
}
