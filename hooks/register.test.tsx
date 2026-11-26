import type { On, PluginOptions } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { OPEN_TIMER_MS } from '../src/panel/timing'
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
const OBS_HOOK = 'command.run:{"command":"obs"}'
const PANEL_HOOKS = ['ui.render:{"component":"AbovePrompt"}']
const CLASSIC_EVENTS = [
  'classic.PermissionDenied',
  'classic.PermissionRequest',
  'classic.PostToolUse',
  'classic.PostToolUseFailure',
]
const FORBIDDEN_EVENTS = ['tool.call', 'tool.run', 'turn.step', 'process.spawn', 'ui.render:{"component":"StatusLine"}']

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
    test(`classic flag off registers exactly the ten capture events, the obs command hook and the panel hooks (${label})`, () => {
      expect(registered(options, false)).toEqual([...CAPTURE_EVENTS, OBS_HOOK, ...PANEL_HOOKS].sort())
    })

    test(`classic flag on adds only the four classic permission hooks (${label})`, () => {
      expect(registered(options, true)).toEqual([...CAPTURE_EVENTS, OBS_HOOK, ...PANEL_HOOKS, ...CLASSIC_EVENTS].sort())
    })

    test(`request and tool-loop hooks are never registered (${label})`, () => {
      for (const classic of [false, true]) {
        for (const name of FORBIDDEN_EVENTS) expect(registered(options, classic)).not.toContain(name)
      }
    })
  }
})

describe('registration order', () => {
  test("registers session.start once and the /obs hook after capture's command.run", () => {
    const order: Array<{ name: string; matcher?: object }> = []
    const on = ((name: string, matcherOrHook: Hook | object, hook?: Hook) => {
      order.push(hook ? { name, matcher: matcherOrHook as object } : { name })
      return { cancel: () => {} }
    }) as unknown as On
    registerHooks(on, {}, false)

    const captureRun = order.findIndex((entry) => entry.name === 'command.run' && entry.matcher === undefined)
    const obsRun = order.findIndex((entry) => entry.name === 'command.run' && JSON.stringify(entry.matcher) === '{"command":"obs"}')
    expect(order.filter((entry) => entry.name === 'session.start')).toHaveLength(1)
    expect(captureRun).toBeGreaterThanOrEqual(0)
    expect(obsRun).toBeGreaterThan(captureRun)
  })
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

describe('obs command hook', () => {
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
    const result = (await hooks.get(OBS_HOOK)?.(host, obs('report'), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(['isTextDisplayOnly', 'text'])
    expect(result.text).toContain('Observability report')
  })

  test('answers the no-data report without touching the filesystem when HOME is missing', async () => {
    const { hooks, host } = setup()
    const reads: string[] = []
    const noHome = {
      ...host,
      env: { get: async () => undefined },
      fs: { list: async (path: string) => (reads.push(path), []), read: async (path: string) => (reads.push(path), '') },
    }
    const result = (await hooks.get(OBS_HOOK)?.(noHome, obs('report'), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(reads).toEqual([])
    expect(result.isTextDisplayOnly).toBe(true)
    expect(result.text).not.toContain('inner')
  })

  test('unknown arguments pass through to next(e)', async () => {
    const { hooks, host } = setup()
    for (const args of ['foo', 'band on extra']) {
      const result = await hooks.get(OBS_HOOK)?.(host, obs(args), async () => ({ text: 'inner' }))
      expect(result).toEqual({ text: 'inner' })
    }
  })

  test('/obs band off answers display-only with no context and persists the setting', async () => {
    const { hooks, host } = setup()
    const stored: Record<string, unknown> = {}
    const withStore = {
      ...host,
      store: { get: async () => undefined, set: async (key: string, value: unknown) => void (stored[key] = value) },
      state: { get: async () => ({ value: undefined, version: 0 }), set: async () => ({ isSet: true, version: 1 }) },
    }
    const result = (await hooks.get(OBS_HOOK)?.(withStore, obs('band off'), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(Object.keys(result).sort()).toEqual(['isTextDisplayOnly', 'text'])
    expect(stored.bandEnabled).toBe(false)
  })

  test('/obs toggles the panel open and closed and answers display-only', async () => {
    const { hooks, host } = setup()
    const stored: Record<string, unknown> = {}
    const withStore = {
      ...host,
      store: { get: async () => undefined, set: async (key: string, value: unknown) => void (stored[key] = value) },
      state: { get: async () => ({ value: undefined, version: 0 }), set: async () => ({ isSet: true, version: 1 }) },
    }
    const opened = (await hooks.get(OBS_HOOK)?.(withStore, obs(''), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(stored.panelOpen).toBe(true)
    expect(opened).toEqual({ text: 'Observatory opened.', isTextDisplayOnly: true })
    const closed = (await hooks.get(OBS_HOOK)?.(withStore, obs(''), async () => ({ text: 'inner' }))) as Record<string, unknown>
    expect(stored.panelOpen).toBe(false)
    expect(closed).toEqual({ text: 'Observatory closed.', isTextDisplayOnly: true })
  })

  test('capture observers return the host result untouched', async () => {
    const { hooks, host } = setup()
    const verdict = { allow: true }
    for (const name of ['agent.spawn', 'agent.report', 'session.measure', 'tool.check']) {
      const result = await hooks.get(name)?.(host, { tool: 'Bash', input: {} }, async () => verdict)
      expect(result).toBe(verdict)
    }
  })

  test('capture still records /obs when the report hook answers beneath it', async () => {
    const { hooks, host, appended } = setup()
    const report = hooks.get(OBS_HOOK)
    const passThrough = async (e: unknown) => e
    await hooks.get('session.start')?.(host, { cwd: '/w', surface: null, isInteractive: true }, passThrough)
    const answer = (await hooks.get('command.run')?.(host, obs('report'), (e) => report!(host, e, passThrough))) as Record<string, unknown>
    await hooks.get('session.end')?.(host, { sessionId: 's1', reason: 'other' }, passThrough)
    expect(answer.isTextDisplayOnly).toBe(true)
    expect(appended.length).toBeGreaterThan(0)
  })
})

describe('live panel wiring', () => {
  const startEvent = { cwd: '/w', surface: null, isInteractive: true }
  const passThrough = async (e: unknown) => e
  const obs = (args: string) => ({ command: 'obs', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  const HOME = '/home/tester'
  const events =
    [
      { schema: 1, id: 'e1', type: 'session.start', ts: 1, sessionId: 's1', agentId: null, branch: null, cwd: '/w', harnessProfile: false },
      { schema: 1, id: 'e2', type: 'session.end', ts: 2, sessionId: 's1', agentId: null, branch: null },
    ]
      .map((record) => JSON.stringify(record))
      .join('\n') + '\n'

  const setup = (stored: { bandEnabled?: boolean; panelOpen?: boolean } = {}) => {
    const { on, hooks } = recordingOn()
    registerHooks(on, {}, false)
    const timers: Array<{ ms: number; fn: () => void; cancelled: boolean }> = []
    const writes: Array<{ ref: unknown; value: unknown }> = []
    const calls = { agentList: 0 }
    const addTimer = (ms: number, fn: () => void) => {
      const timer = { ms, fn, cancelled: false }
      timers.push(timer)
      return { cancel: () => void (timer.cancelled = true) }
    }
    const host = {
      session: { id: async () => 's1', usage: async () => ({ startedAt: 1, cost: { usd: 0 } }) },
      agent: { list: async () => (calls.agentList++, []) },
      env: { get: async () => HOME },
      fs: {
        list: async (dir: string) =>
          dir.endsWith('/events') ? [{ name: 's1.jsonl', kind: 'file', size: events.length, mtimeMs: 1, isLink: false }] : [],
        read: async (path: string, range?: { offset: number; length: number }) => {
          if (!path.endsWith('events/s1.jsonl')) throw new Error('ENOENT')
          return range ? { base64: btoa(events.slice(range.offset, range.offset + range.length)) } : events
        },
      },
      vcs: { detect: async () => null },
      clock: { every: addTimer, after: addTimer },
      process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
      command: { register: async () => undefined },
      store: { get: async (key: string) => stored[key as keyof typeof stored], set: async () => undefined },
      state: {
        get: async () => ({ value: undefined, version: 0 }),
        set: async (ref: unknown, value: unknown) => (writes.push({ ref, value }), { isSet: true, version: 1 }),
      },
    }
    const settle = async () => {
      for (let i = 0; i < 50; i++) await Promise.resolve()
    }
    const sessionStart = async () => {
      await hooks.get('session.start')?.(host, startEvent, passThrough)
      await settle()
    }
    const openTimer = () => timers.find((timer) => timer.ms === OPEN_TIMER_MS && !timer.cancelled)
    return { hooks, host, timers, writes, calls, sessionStart, settle, openTimer }
  }

  const writtenValues = (writes: Array<{ ref: unknown; value: unknown }>, key: string) =>
    writes.filter((write) => (write.ref as { key: string }).key === key).map((write) => (write.value as { value: unknown }).value)

  test('session.start with a stored bandEnabled false keeps the band off and the panel closed', async () => {
    const { sessionStart, writes, openTimer } = setup({ bandEnabled: false, panelOpen: true })
    await sessionStart()
    expect(writtenValues(writes, 'bandEnabled')).toEqual([false])
    expect(writtenValues(writes, 'panelOpen')).toEqual([false])
    expect(openTimer()).toBeUndefined()
  })

  test('session.start with a stored panelOpen true reopens the panel and starts the timer', async () => {
    const { sessionStart, writes, openTimer } = setup({ panelOpen: true })
    await sessionStart()
    expect(writtenValues(writes, 'panelOpen')).toEqual([true])
    expect(openTimer()).toBeDefined()
  })

  test('session.start resets the previous session figures instead of keeping them', async () => {
    const { sessionStart, writes } = setup()
    await sessionStart()
    await sessionStart()
    const sessions = writtenValues(writes, 'session')
    expect(sessions[0]).toBeNull()
    expect(sessions.some((value) => value !== null)).toBe(true)
    expect(sessions.at(-1)).toBeNull()
  })

  test('/obs builds the panel on a host that never saw session.start, so the panel refreshes', async () => {
    const { hooks, host, writes, settle } = setup()
    await hooks.get(OBS_HOOK)?.(host, obs(''), passThrough)
    await settle()
    expect(writtenValues(writes, 'session').some((value) => value !== null)).toBe(true)
  })

  test('toggling /obs closed stops the 5 s timer and later time reloads nothing', async () => {
    const { hooks, host, calls, settle, openTimer } = setup()
    await hooks.get(OBS_HOOK)?.(host, obs(''), passThrough)
    await settle()
    const timer = openTimer()
    expect(timer).toBeDefined()
    await hooks.get(OBS_HOOK)?.(host, obs(''), passThrough)
    expect(timer?.cancelled).toBe(true)
    const reloads = calls.agentList
    timer?.fn()
    await settle()
    expect(calls.agentList).toBe(reloads)
  })

  test('/obs band off closes an open panel and stops the timer', async () => {
    const { hooks, host, settle, openTimer, writes } = setup()
    await hooks.get(OBS_HOOK)?.(host, obs(''), passThrough)
    await settle()
    const timer = openTimer()
    await hooks.get(OBS_HOOK)?.(host, obs('band off'), passThrough)
    expect(timer?.cancelled).toBe(true)
    expect(writtenValues(writes, 'panelOpen').at(-1)).toBe(false)
  })
})
