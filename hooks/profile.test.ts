import type { On, PluginOptions } from 'claude-code'
import { describe, expect, test } from 'claude-code/testing'
import { registerHooks } from './register'

type Hook = (host: unknown, e: unknown, next: (e: unknown) => Promise<unknown>) => Promise<unknown>
type AnyRecord = Record<string, unknown> & { type?: string; schema?: unknown }

const SPAWN_PROMPT = 'Build it.\nSKILLS:\n- /skills/alpha/SKILL.md\n- /skills/beta/SKILL.md\n'
const DENY_REASON = 'Blocked by infra-agent-bash-guard: no rm'
const USAGE = { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 30, cache_creation_input_tokens: 40, model: 'm' }

const runSession = async (options: PluginOptions) => {
  const hooks = new Map<string, Hook>()
  // A matched registration (`on(name, matcher, hook)`) belongs to the panel (`/obs`, band), not capture: keep it under its own key.
  registerHooks(
    ((name: string, matcherOrHook: Hook | object, hook?: Hook) => hooks.set(hook ? `${name}:matched` : name, hook ?? (matcherOrHook as Hook))) as unknown as On,
    options,
  )

  const world = { usd: 0, agents: [] as unknown[] }
  const events: AnyRecord[] = []
  const prompts: AnyRecord[] = []
  const snapshots: AnyRecord[] = []
  const host = {
    session: { id: async () => 's1', usage: async () => ({ startedAt: 1, cost: { usd: world.usd } }) },
    agent: { list: async () => world.agents },
    env: { get: async () => undefined },
    vcs: { detect: async () => ({ branch: 'feature/x' }) },
    clock: { every: () => ({ cancel: () => {} }) },
    process: {
      run: async (argv: string[], init?: { stdin?: string }) => {
        const path = argv[4] ?? ''
        const lines = (init?.stdin ?? '').split('\n').filter(Boolean).map((line) => JSON.parse(line) as AnyRecord)
        if (path.startsWith('events/')) events.push(...lines)
        else if (path.startsWith('prompts-')) prompts.push(...lines)
        else if (path.startsWith('snapshots/')) snapshots.push(...lines)
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  }
  const fire = (name: string, e: unknown, result: unknown = {}) => hooks.get(name)?.(host, e, async () => result)

  await fire('session.start', { cwd: '/w', surface: null, isInteractive: true }, { cwd: '/w' })
  await fire('agent.spawn', { prompt: SPAWN_PROMPT, subagentType: 'builder' }, { agentId: 'a1', model: 'm' })
  world.usd = 0.5
  world.agents = [{ id: 'a1', type: 'builder', taskStatus: 'running', tokenCount: 5, cost: { usd: 0.2 }, usage: [USAGE] }]
  await fire('tool.check', { tool: 'Bash', input: { command: 'rm -rf x' }, tool_use_id: 't1', agentId: 'a1' }, { decision: 'deny', reason: DENY_REASON, hook: 'h' })
  await fire('tool.check', { tool: 'mcp__srv__lookup', input: {}, tool_use_id: 't2' }, { decision: 'allow' })
  await fire('tool.check', { tool: 'Read', input: { file_path: '/s/skills/foo/SKILL.md' }, tool_use_id: 't3', agentId: 'a1' }, { decision: 'allow' })
  await fire('agent.report', { agentId: 'a1', subagentType: 'builder', status: 'completed', text: 'done\nstatus: DONE' })
  await fire('turn.complete', { durationMs: 5, usage: USAGE, answer: '', isAborted: false, turnId: 't', reason: 'answer' })
  await fire('session.compact', { trigger: 'manual' })
  await fire('command.run', { command: 'status' })
  await fire('session.measure', { cost: { usd: 0.5 }, context: {}, rateLimits: [], changed: [] })
  await fire('tool.check', { tool: 'Bash', input: { command: 'ls' }, tool_use_id: 't4' }, { decision: 'allow' })
  await fire('session.end', { sessionId: 's1', reason: 'other' })
  return { events, prompts, snapshots }
}

const ofType = (events: AnyRecord[], type: string): AnyRecord[] => events.filter((e) => e.type === type)

const fieldNamesByType = (events: AnyRecord[]): Record<string, string[]> => {
  const names: Record<string, string[]> = {}
  for (const event of events) names[String(event.type)] = Object.keys(event).sort()
  return names
}

describe('profile on/off parity', () => {
  test('both modes write schema 1 and the same field names', async () => {
    const on = await runSession({ harnessProfile: true })
    const off = await runSession({})
    for (const run of [on, off]) {
      for (const record of [...run.events, ...run.prompts, ...run.snapshots]) expect(record.schema).toBe(1)
    }
    expect(fieldNamesByType(on.events)).toEqual(fieldNamesByType(off.events))
  })

  test('profile off: profile fields are null or absent and generic capture is populated', async () => {
    const { events, prompts } = await runSession({})
    expect(ofType(events, 'session.start')[0]).toMatchObject({ harnessProfile: false })
    expect(ofType(events, 'agent.spawn')[0]).toMatchObject({ skillsInjected: null, promptId: 'pr-a1', agentId: 'a1' })
    expect(prompts[0]).toMatchObject({ promptId: 'pr-a1', text: SPAWN_PROMPT })
    expect(ofType(events, 'agent.report')[0]).toMatchObject({ engineStatus: 'completed', status: null, parserVersion: null })
    const verdicts = ofType(events, 'tool.verdict')
    expect(verdicts[0]).toMatchObject({ decision: 'deny', guard: null, reason: DENY_REASON, command: 'rm -rf x', agentId: 'a1' })
    expect(verdicts[1]).toMatchObject({ mcpServer: 'srv' })
    expect(ofType(events, 'skill.use')[0]).toMatchObject({ skill: 'foo', kind: 'read', agentId: 'a1' })
    expect(ofType(events, 'command.run')[0]).toMatchObject({ name: 'status' })
    expect(ofType(events, 'session.compact')).toHaveLength(1)
    expect(ofType(events, 'turn.complete')[0]).toMatchObject({ usage: { input: 10, output: 20, cacheRead: 30, cacheCreation: 40, model: 'm' } })
    expect(ofType(events, 'reconciliation')).toHaveLength(1)
    for (const event of events) expect(event.branch).toBe('feature/x')
  })

  test('a non-boolean harnessProfile value counts as off', async () => {
    const { events } = await runSession({ harnessProfile: 'true' })
    expect(ofType(events, 'session.start')[0]).toMatchObject({ harnessProfile: false })
  })

  test('profile on: profile fields are populated', async () => {
    const { events } = await runSession({ harnessProfile: true })
    expect(ofType(events, 'session.start')[0]).toMatchObject({ harnessProfile: true })
    expect(ofType(events, 'agent.spawn')[0]).toMatchObject({ skillsInjected: ['/skills/alpha/SKILL.md', '/skills/beta/SKILL.md'] })
    expect(ofType(events, 'agent.report')[0]).toMatchObject({ engineStatus: 'completed', status: 'DONE', parserVersion: 1 })
    expect(ofType(events, 'tool.verdict')[0]).toMatchObject({ guard: 'infra-agent-bash-guard' })
  })
})
