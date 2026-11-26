import { describe, expect, test } from 'claude-code/testing'
import { historyLines } from './history'
import { sessionLines } from './session'
import { aggregate, context, sessionAtomValue, sessionFigures, textOf } from './test-kit'

const live = sessionAtomValue(sessionFigures(), aggregate())

describe('history states', () => {
  test('idle and loading both read as loading', () => {
    for (const status of ['idle', 'loading'] as const) {
      expect(historyLines(context('wide', { history: { status } }))).toEqual([{ text: 'Loading history...', dim: true }])
    }
  })

  test('an unavailable load shows the reason while Session scope still renders', () => {
    const history = { status: 'unavailable' as const, reason: 'report aggregates not available' }
    expect(textOf(historyLines(context('wide', { history })))).toBe('History unavailable: report aggregates not available')
    expect(textOf(sessionLines(context('wide', { scope: 'history', history, session: live })))).toContain('History unavailable')
    expect(textOf(sessionLines(context('wide', { scope: 'session', history, session: live })))).toContain('Agent tree')
  })

  test('tab 5 renders the History layout whatever the stored scope', () => {
    const history = { status: 'ready' as const, aggregate: aggregate({ sessions: 7 }) }
    expect(textOf(historyLines(context('wide', { scope: 'session', history, session: live })))).toContain('Sessions: 7')
  })

  test('the History scope of a tab 1-4 reads the same atom', () => {
    const history = { status: 'ready' as const, aggregate: aggregate({ sessions: 7 }) }
    expect(textOf(sessionLines(context('wide', { scope: 'history', history })))).toContain('Sessions: 7')
  })
})
