import type { On, PluginOptions } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { registerHooks } from './register'

const CAPTURE_EVENTS = [
  'agent.report',
  'agent.spawn',
  'command.run',
  'session.compact',
  'session.end',
  'session.measure',
  'session.start',
  'skill.prompt',
  'tool.check',
  'turn.complete',
]
const CLASSIC_EVENTS = [
  'classic.PermissionDenied',
  'classic.PermissionRequest',
  'classic.PostToolUse',
  'classic.PostToolUseFailure',
]
const FORBIDDEN_EVENTS = ['tool.call', 'tool.run', 'turn.step', 'process.spawn']

type Hook = (host: unknown, e: unknown, next: (e: unknown) => Promise<unknown>) => Promise<unknown>

const recordingOn = () => {
  const hooks = new Map<string, Hook>()
  const on = ((name: string, hook: Hook) => {
    hooks.set(name, hook)
    return { cancel: () => {} }
  }) as unknown as On
  return { on, hooks }
}

const registered = (options: PluginOptions, classic: boolean): string[] => {
  const { on, hooks } = recordingOn()
  registerHooks(on, options, classic)
  return [...hooks.keys()].sort()
}

describe('registration set', () => {
  const profileModes: Array<[string, PluginOptions]> = [
    ['profile on', { harnessProfile: true }],
    ['options omitted', {}],
    ['non-boolean profile value', { harnessProfile: 'true' }],
  ]

  for (const [label, options] of profileModes) {
    test(`classic flag off registers exactly the ten capture events (${label})`, () => {
      expect(registered(options, false)).toEqual(CAPTURE_EVENTS)
    })

    test(`classic flag on adds only the four classic permission hooks (${label})`, () => {
      expect(registered(options, true)).toEqual([...CAPTURE_EVENTS, ...CLASSIC_EVENTS].sort())
    })

    test(`request and tool-loop hooks are never registered (${label})`, () => {
      for (const classic of [false, true]) {
        for (const name of FORBIDDEN_EVENTS) expect(registered(options, classic)).not.toContain(name)
      }
    })
  }
})

describe('profile read once at register', () => {
  const sessionStartRecord = async (options: PluginOptions): Promise<{ harnessProfile?: unknown }> => {
    const { on, hooks } = recordingOn()
    registerHooks(on, options, false)
    const appended: string[] = []
    const host = {
      session: {
        id: async () => 's1',
        usage: async () => ({ startedAt: 1, cost: { usd: 0 } }),
      },
      agent: { list: async () => [] },
      env: { get: async () => undefined },
      vcs: { detect: async () => null },
      clock: { every: () => ({ cancel: () => {} }) },
      process: {
        run: async (argv: string[], init?: { stdin?: string }) => {
          if (argv[4]?.startsWith('events/') && init?.stdin) appended.push(init.stdin)
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    }
    const passThrough = async (e: unknown) => e
    await hooks.get('session.start')?.(host, { cwd: '/w', surface: null, isInteractive: true }, passThrough)
    await hooks.get('session.end')?.(host, { sessionId: 's1', reason: 'other' }, passThrough)
    const start = appended.flatMap((text) => text.split('\n').filter(Boolean).map((line) => JSON.parse(line)))
    return start.find((record) => record.type === 'session.start')
  }

  test('harnessProfile true is written as true', async () => {
    expect((await sessionStartRecord({ harnessProfile: true }))?.harnessProfile).toBe(true)
  })

  test('omitted and non-boolean values are written as false', async () => {
    expect((await sessionStartRecord({}))?.harnessProfile).toBe(false)
    expect((await sessionStartRecord({ harnessProfile: 'true' }))?.harnessProfile).toBe(false)
  })
})
