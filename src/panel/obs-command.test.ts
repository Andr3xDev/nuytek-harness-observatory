import { describe, expect, test } from 'claude-code/testing'
import { handleObs, parseObsArgs, type ObsCommand, type ObsDeps } from './obs-command'

describe('parseObsArgs', () => {
  const cases: [string, ObsCommand][] = [
    ['', 'toggle'],
    ['   ', 'toggle'],
    ['band on', 'band-on'],
    ['  band   on  ', 'band-on'],
    ['band off', 'band-off'],
    ['band  off', 'band-off'],
    ['band', 'band-usage'],
    ['band x', 'band-usage'],
    ['report', 'report'],
    ['  report  now', 'report'],
    ['reports', 'other'],
    ['foo', 'other'],
    ['band on extra', 'other'],
    ['Band On', 'other'],
  ]
  for (const [args, expected] of cases) {
    test(`parses ${JSON.stringify(args)} as ${expected}`, () => {
      expect(parseObsArgs(args)).toBe(expected)
    })
  }
})

describe('handleObs', () => {
  const setup = (overrides: Partial<ObsDeps> = {}) => {
    const calls: string[] = []
    const deps: ObsDeps = {
      isPaneOpen: async () => false,
      closePane: async () => void calls.push('close'),
      openPane: async () => (calls.push('open'), { isPlaced: true }),
      resetScope: async () => void calls.push('reset'),
      onOpened: () => void calls.push('opened'),
      setBandEnabled: async enabled => void calls.push(`band:${enabled}`),
      ...overrides,
    }
    return { deps, calls }
  }

  test('toggle on a closed pane resets the scope, opens it and starts the refresh', async () => {
    const { deps, calls } = setup()
    expect(await handleObs('toggle', deps)).toEqual({ text: 'Observatory opened.', isTextDisplayOnly: true })
    expect(calls).toEqual(['reset', 'open', 'opened'])
  })

  test('toggle on an open pane closes it and opens nothing', async () => {
    const { deps, calls } = setup({ isPaneOpen: async () => true })
    expect(await handleObs('toggle', deps)).toEqual({ text: 'Observatory closed.', isTextDisplayOnly: true })
    expect(calls).toEqual(['close'])
  })

  test('an unplaced pane skips the refresh and returns the reason as text', async () => {
    const { deps, calls } = setup({ openPane: async () => ({ isPlaced: false, reason: 'terminal too narrow' }) })
    const result = await handleObs('toggle', deps)
    expect(result?.text).toContain('terminal too narrow')
    expect(calls).not.toContain('opened')
  })

  test('band on and off persist the setting and answer display-only without context', async () => {
    const { deps, calls } = setup()
    const off = await handleObs('band-off', deps)
    await handleObs('band-on', deps)
    expect(calls).toEqual(['band:false', 'band:true'])
    expect(Object.keys(off ?? {}).sort()).toEqual(['isTextDisplayOnly', 'text'])
  })

  test('band usage is display-only text', async () => {
    const result = await handleObs('band-usage', setup().deps)
    expect(result).toEqual({ text: 'Usage: /obs band on|off', isTextDisplayOnly: true })
  })
})
