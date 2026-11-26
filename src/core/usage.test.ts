import { describe, expect, test } from 'claude-code/testing'
import { mapUsage } from './usage'

describe('mapUsage', () => {
  test('maps snake_case host usage to camelCase', () => {
    expect(
      mapUsage({
        input_tokens: 1,
        output_tokens: 2,
        cache_read_input_tokens: 3,
        cache_creation_input_tokens: 4,
        model: 'm',
      }),
    ).toEqual({ input: 1, output: 2, cacheRead: 3, cacheCreation: 4, model: 'm' })
  })
})
