import { describe, expect, test } from 'claude-code/testing'
import { handleObs, parseObsArgs, type ObsCommand, type ObsDeps } from './obs-command'

describe('parseObsArgs', () => {
  const cases: [string, ObsCommand][] = [
    ['', 'toggle'],
    ['   ', 'toggle'],
    ['report', 'other'],
    ['foo', 'other'],
    ['band on', 'other'],
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
      ...overrides,
    }
    return { deps, calls }
  }

  test('toggle on a closed panel opens it', async () => {
    const { deps, calls } = setup()
    expect(await handleObs(deps)).toEqual({ text: 'Observatory opened.', isTextDisplayOnly: true })
    expect(calls).toEqual(['open:true'])
  })

  test('toggle on an open panel closes it and opens nothing', async () => {
    const { deps, calls } = setup({ isOpen: () => true })
    expect(await handleObs(deps)).toEqual({ text: 'Observatory closed.', isTextDisplayOnly: true })
    expect(calls).toEqual(['open:false'])
  })
})
