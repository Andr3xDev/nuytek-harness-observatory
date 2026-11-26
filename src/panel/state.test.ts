import { describe, expect, test } from 'claude-code/testing'
import { forgetPanelOpen, isPanelOpen, rememberPanelOpen } from './state'

function countingReader(result: boolean | Error) {
  const reader = {
    calls: 0,
    read: async () => {
      reader.calls += 1
      if (result instanceof Error) throw result
      return result
    },
  }
  return reader
}

describe('isPanelOpen', () => {
  test('an open atom short-circuits without reading the store', async () => {
    forgetPanelOpen()
    const reader = countingReader(false)
    expect(await isPanelOpen(true, 's1', reader.read)).toBe(true)
    expect(reader.calls).toBe(0)
  })

  test('reads the store once per session id and re-reads for a new one', async () => {
    forgetPanelOpen()
    const reader = countingReader(true)
    expect(await isPanelOpen(false, 's1', reader.read)).toBe(true)
    expect(await isPanelOpen(false, 's1', reader.read)).toBe(true)
    expect(reader.calls).toBe(1)
    await isPanelOpen(false, 's2', reader.read)
    expect(reader.calls).toBe(2)
  })

  test('rememberPanelOpen(false) wins over an earlier cached true', async () => {
    forgetPanelOpen()
    const reader = countingReader(true)
    await isPanelOpen(false, 's1', reader.read)
    rememberPanelOpen('s1', false)
    expect(await isPanelOpen(false, 's1', reader.read)).toBe(false)
    expect(reader.calls).toBe(1)
  })

  test('a failed read returns false and is not memoized', async () => {
    forgetPanelOpen()
    const reader = countingReader(new Error('store down'))
    expect(await isPanelOpen(false, 's1', reader.read)).toBe(false)
    expect(await isPanelOpen(false, 's1', reader.read)).toBe(false)
    expect(reader.calls).toBe(2)
  })
})
