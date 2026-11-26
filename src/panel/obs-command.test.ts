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
      isOpen: () => false,
      setOpen: async open => void calls.push(`open:${open}`),
      resetScope: async () => void calls.push('reset'),
      setBandEnabled: async enabled => void calls.push(`band:${enabled}`),
      ...overrides,
    }
    return { deps, calls }
  }

  test('toggle on a closed panel resets the scope, shows the band and opens it', async () => {
    const { deps, calls } = setup()
    expect(await handleObs('toggle', deps)).toEqual({ text: 'Observatory opened.', isTextDisplayOnly: true })
    expect(calls).toEqual(['reset', 'band:true', 'open:true'])
  })

  test('toggle on an open panel closes it and opens nothing', async () => {
    const { deps, calls } = setup({ isOpen: () => true })
    expect(await handleObs('toggle', deps)).toEqual({ text: 'Observatory closed.', isTextDisplayOnly: true })
    expect(calls).toEqual(['open:false'])
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
