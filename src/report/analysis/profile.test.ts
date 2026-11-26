import { describe, expect, test } from 'claude-code/testing'
import { summarizeSession } from './session'
import { CTX, mainSnapshot, sessionStart, spawn, usage, verdict } from './test-fixtures'

type Events = Parameters<typeof summarizeSession>[0]['events']

const summarize = (events: Events) => summarizeSession({ events, snapshots: [] }, CTX)

describe('profile off', () => {
  test('profile is null, never zero, while generic figures stay present', () => {
    const figures = summarizeSession(
      {
        events: [sessionStart({ harnessProfile: false }), verdict('t1', 'deny'), spawn('a1')],
        snapshots: [mainSnapshot({ usage: [usage(10, 0, 30, 0)], costUsd: 0.5 })],
      },
      CTX,
    )

    expect(figures.harnessProfile).toBe(false)
    expect(figures.profile).toBeNull()
    expect(figures.total).toMatchObject({ tokens: 40, costUsd: 0.5 })
  })

  test('a session without session.start is profile off', () => {
    const figures = summarize([verdict('t1', 'allow')])

    expect(figures.harnessProfile).toBe(false)
    expect(figures.profile).toBeNull()
  })
})

describe('profile on', () => {
  test('counts the skills injected into spawn prompts', () => {
    const profile = summarize([
      sessionStart({ harnessProfile: true }),
      spawn('r1', { skillsInjected: ['alpha', 'beta'] }),
      spawn('r2', { skillsInjected: ['alpha'] }),
    ]).profile

    expect(profile).toEqual({ skillsInjected: { alpha: 2, beta: 1 } })
  })
})
