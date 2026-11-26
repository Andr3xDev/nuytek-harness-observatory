import type { UsageRecord } from './schema'

/** Host `TurnUsage`, snake_case. */
export type HostUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
  model: string
}

export const mapUsage = (usage: HostUsage): UsageRecord => ({
  input: usage.input_tokens,
  output: usage.output_tokens,
  cacheRead: usage.cache_read_input_tokens,
  cacheCreation: usage.cache_creation_input_tokens,
  model: usage.model,
})
