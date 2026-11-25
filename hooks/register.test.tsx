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
const REPORT_HOOK = 'command.run:{"command":"obs"}'
const CLASSIC_EVENTS = [
  'classic.PermissionDenied',
  'classic.PermissionRequest',
  'classic.PostToolUse',
  'classic.PostToolUseFailure',
]
const FORBIDDEN_EVENTS = ['tool.call', 'tool.run', 'turn.step', 'process.spawn']

type Hook = (host: unknown, e: unknown, next: (e: unknown) => Promise<unknown>) => Promise<unknown>

/** A matched registration is keyed `name:<matcher JSON>` so it does not shadow capture's unmatched hook. */
const recordingOn = () => {
  const hooks = new Map<string, Hook>()
  const on = ((name: string, matcherOrHook: Hook | object, hook?: Hook) => {
    hooks.set(hook ? `${name}:${JSON.stringify(matcherOrHook)}` : name, hook ?? (matcherOrHook as Hook))
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
    test(`classic flag off registers exactly the ten capture events plus the obs command hook (${label})`, () => {
      expect(registered(options, false)).toEqual([...CAPTURE_EVENTS, REPORT_HOOK].sort())
    })

    test(`classic flag on adds only the four classic permission hooks (${label})`, () => {
      expect(registered(options, true)).toEqual([...CAPTURE_EVENTS, REPORT_HOOK, ...CLASSIC_EVENTS].sort())
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

describe('obs report command hook', () => {
  const HOME = '/home/tester'
  const STORE = `${HOME}/.claude/observability`
  const fileRecords = [
    { schema: 1, id: 'e1', type: 'session.start', ts: 1, sessionId: 's1', agentId: null, branch: null, cwd: '/w', harnessProfile: false },
    { schema: 1, id: 'e2', type: 'session.end', ts: 2, sessionId: 's1', agentId: null, branch: null },
  ]
  const store: Record<string, string> = { 'events/s1.jsonl': fileRecords.map((record) => JSON.stringify(record)).join('\n') + '\n' }

  const setup = (options: PluginOptions = {}) => {
    const { on, hooks } = recordingOn()
    registerHooks(on, options, false)
    const appended: string[] = []
    const relative = (path: string) => path.slice(STORE.length + 1)
    const host = {
      session: { id: async () => 's1', usage: async () => ({ startedAt: 1, cost: { usd: 0 } }) },
      agent: { list: async () => [] },
      env: { get: async () => HOME },
      vcs: { detect: async () => null },
      clock: { every: () => ({ cancel: () => {} }) },
      fs: {
        list: async (dir: string) =>
          Object.entries(store)
            .filter(([path]) => path.startsWith(`${relative(dir)}/`))
            .map(([path, content]) => ({ name: path.split('/')[1], kind: 'file', size: content.length, mtimeMs: 1, isLink: false })),
        read: async (path: string, range?: { offset: number; length: number }) => {
          const content = store[relative(path)]
          if (content === undefined) throw new Error('ENOENT')
          return range ? { base64: btoa(content.slice(range.offset, range.offset + range.length)) } : content
        },
      },
      process: {
        run: async (argv: string[], init?: { stdin?: string }) => {
          if (init?.stdin) appended.push(argv[4] ?? '')
          return { exitCode: 0, stdout: '', stderr: '' }
        },
      },
    }
    return { hooks, host, appended }
  }

  const obs = (args: string) => ({ command: 'obs', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  test('answers /obs report display-only with exactly text and isTextDisplayOnly', async () => {
    const { hooks, host } = setup()
    const result = (await hooks.get(REPORT_HOOK)?.(host, obs('report'), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(['isTextDisplayOnly', 'text'])
    expect(result.text).toContain('Observability report')
  })

  test('/obs and /obs band are not intercepted', async () => {
    const { hooks, host } = setup()
    for (const args of ['', 'band', 'band on']) {
      const result = await hooks.get(REPORT_HOOK)?.(host, obs(args), async () => ({ text: 'inner' }))
      expect(result).toEqual({ text: 'inner' })
    }
  })

  test('capture still records /obs when the report hook answers beneath it', async () => {
    const { hooks, host, appended } = setup()
    const report = hooks.get(REPORT_HOOK)
    const passThrough = async (e: unknown) => e
    await hooks.get('session.start')?.(host, { cwd: '/w', surface: null, isInteractive: true }, passThrough)
    const answer = (await hooks.get('command.run')?.(host, obs('report'), (e) => report!(host, e, passThrough))) as Record<string, unknown>
    await hooks.get('session.end')?.(host, { sessionId: 's1', reason: 'other' }, passThrough)
    expect(answer.isTextDisplayOnly).toBe(true)
    expect(appended.length).toBeGreaterThan(0)
  })
})
