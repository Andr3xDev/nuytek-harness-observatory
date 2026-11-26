import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { CTX, mainSnapshot, report, sessionEnd, sessionStart, spawn, usage, verdict } from './test-fixtures'

type Events = Parameters<typeof summarizeSession>[0]['events']

const profileOn = () => sessionStart({ harnessProfile: true })
const summarize = (events: Events) => summarizeSession({ events, snapshots: [] }, CTX)

describe('profile off', () => {
  test('profile and bashPromptHook are null, never zero, while generic figures stay present', () => {
    const figures = summarizeSession(
      {
        events: [sessionStart({ harnessProfile: false }), verdict('t1', 'deny'), spawn('a1')],
        snapshots: [mainSnapshot({ usage: [usage(10, 0, 30, 0)], costUsd: 0.5 })],
      },
      CTX,
    )

    expect(figures.harnessProfile).toBe(false)
    expect(figures.profile).toBeNull()
    expect(figures.tools.bashPromptHook).toBeNull()
    expect(figures.total).toMatchObject({ tokens: 40, costUsd: 0.5 })
    expect(figures.denies).toBe(1)
  })

  test('a session without session.start is profile off', () => {
    const figures = summarize([verdict('t1', 'allow')])

    expect(figures.harnessProfile).toBe(false)
    expect(figures.profile).toBeNull()
  })
})

describe('profile on', () => {
  test('counts the envelope status per type and a null status with parserVersion as unknown', () => {
    const profile = summarize([
      profileOn(),
      spawn('a1'),
      spawn('a2'),
      report('a1', { status: 'done', parserVersion: 1 }),
      report('a2', { status: null, parserVersion: 1 }),
    ]).profile

    expect(profile?.statusMixByType.builder).toEqual({ done: 1, unknown: 1 })
  })

  test('counts a re-route for quick-builder blocked with needs-builder and test-writer blocked with tests-not-worth-it', () => {
    const profile = summarize([
      profileOn(),
      report('q1', { subagentType: 'quick-builder', status: 'blocked', parserVersion: 1, reportExcerpt: 'blocked: needs-builder' }),
      report('q2', { subagentType: 'quick-builder', status: 'blocked', parserVersion: 1, reportExcerpt: 'blocked: other reason' }),
      report('t1', { subagentType: 'test-writer', status: 'blocked', parserVersion: 1, reportExcerpt: 'tests-not-worth-it' }),
    ]).profile

    expect(profile?.reroutesByType['quick-builder']).toBe(1)
    expect(profile?.reroutesByType['test-writer']).toBe(1)
  })

  test('counts code-reviewer spawns as review passes, injected skills and guards', () => {
    const profile = summarize([
      profileOn(),
      spawn('r1', { subagentType: 'code-reviewer', skillsInjected: ['alpha', 'beta'] }),
      spawn('r2', { subagentType: 'code-reviewer', skillsInjected: ['alpha'] }),
      verdict('t1', 'deny', { guard: 'bash-guard' }),
    ]).profile

    expect(profile).toMatchObject({ reviewPasses: 2, skillsInjected: { alpha: 2, beta: 1 }, guards: { 'bash-guard': 1 } })
  })

  test('bashPromptHook calls are distinct Bash toolUseIds and usd comes from the session.end estimate', () => {
    const hook = summarize([
      profileOn(),
      verdict('t1', 'allow'),
      verdict('t1', 'allow'),
      verdict('t2', 'allow'),
      verdict('t3', 'allow'),
      verdict('t4', 'allow', { toolName: 'Read' }),
      sessionEnd({ estimates: { bashPromptHook: { label: 'estimated', calls: 7, usd: 0.02 } } }),
    ]).tools.bashPromptHook

    expect(hook).toEqual({ calls: 3, usd: 0.02 })
  })

  test('bashPromptHook keeps calls and has a null usd when there is no estimate', () => {
    const hook = summarize([profileOn(), verdict('t1', 'allow'), verdict('t2', 'allow')]).tools.bashPromptHook

    expect(hook).toEqual({ calls: 2, usd: null })
  })
})
