import { describe, expect, test } from 'claude-code/testing'
import { ROLLUP_VERSION, buildRollup, isRollupFresh } from './rollup'
import { summarizeSession } from './session'
import { CTX, mainSnapshot, sessionEnd, sessionStart, snapshot, spawn, usage } from './test-fixtures'
import type { SessionRollup, SourceListing } from './types'

const BUILT_AT = 123
const listing: SourceListing = {
  'events/s1.jsonl': { size: 100, mtimeMs: 5 },
  'snapshots/main-s1.json': { size: 20, mtimeMs: 6 },
  'snapshots/a1.json': { size: 30, mtimeMs: 7 },
}

const closedFigures = () =>
  summarizeSession(
    {
      events: [sessionStart(), spawn('a1'), sessionEnd()],
      snapshots: [mainSnapshot({ usage: [usage(1, 0, 0, 0)] }), snapshot('a1', { usage: [usage(2, 0, 0, 0)] })],
    },
    CTX,
  )
const build = (): SessionRollup => buildRollup(closedFigures(), listing, BUILT_AT)

describe('buildRollup', () => {
  test('stores the payload fields and the events, main and agent snapshot sources', () => {
    const figures = closedFigures()
    const rollup = buildRollup(figures, listing, BUILT_AT)

    expect(rollup).toMatchObject({ rollupVersion: ROLLUP_VERSION, schemaVersions: [1], sessionId: 's1', state: 'closed', builtAt: BUILT_AT })
    expect(rollup.figures).toEqual(figures)
    expect([...rollup.sources].sort((a, b) => a.path.localeCompare(b.path))).toEqual([
      { path: 'events/s1.jsonl', size: 100, mtimeMs: 5 },
      { path: 'snapshots/a1.json', size: 30, mtimeMs: 7 },
      { path: 'snapshots/main-s1.json', size: 20, mtimeMs: 6 },
    ])
  })
})

describe('isRollupFresh', () => {
  test('an unchanged rollup is fresh, also after a JSON round trip', () => {
    expect(isRollupFresh(build(), listing)).toBe(true)
    expect(isRollupFresh(JSON.parse(JSON.stringify(build())), listing)).toBe(true)
  })

  const staleListings: Array<[string, SourceListing]> = [
    ['events size changed', { ...listing, 'events/s1.jsonl': { size: 101, mtimeMs: 5 } }],
    ['events mtime changed', { ...listing, 'events/s1.jsonl': { size: 100, mtimeMs: 6 } }],
    ['agent snapshot mtime changed', { ...listing, 'snapshots/a1.json': { size: 30, mtimeMs: 8 } }],
    ['agent snapshot pruned', { 'events/s1.jsonl': listing['events/s1.jsonl']!, 'snapshots/main-s1.json': listing['snapshots/main-s1.json']! }],
  ]
  for (const [name, current] of staleListings) {
    test(`is not fresh when ${name}`, () => {
      expect(isRollupFresh(build(), current)).toBe(false)
    })
  }

  const staleRollups: Array<[string, () => unknown]> = [
    ['the version differs', () => ({ ...build(), rollupVersion: ROLLUP_VERSION + 1 })],
    ['a schema version is unsupported', () => ({ ...build(), schemaVersions: [1, 2] })],
    ['the state is open', () => ({ ...build(), state: 'open' })],
    ['it is a string', () => 'corrupt'],
    ['it is null', () => null],
    ['it has no keys', () => ({})],
    ['it has no sources', () => ({ rollupVersion: ROLLUP_VERSION, schemaVersions: [1], sessionId: 's1', state: 'closed' })],
  ]
  for (const [name, makeRollup] of staleRollups) {
    test(`is not fresh when ${name}`, () => {
      expect(isRollupFresh(makeRollup(), listing)).toBe(false)
    })
  }
})
