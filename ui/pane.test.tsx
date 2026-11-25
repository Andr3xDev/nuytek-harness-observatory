import { expect, test } from 'claude-code/testing'
import { PANE_ID } from './pane'
import { WIDTHS, agent, aggregate, installState, mountTarget, sessionAtomValue, sessionFigures } from './tabs/test-kit'

// These mount the pane through the plugin, so they need the panel wired into hooks/register.tsx (task 4.2).
const ready = sessionAtomValue(sessionFigures([agent('a1')]), aggregate())

test('default render shows Session content and the shell controls', async ($, on) => {
  installState(on, { session: ready })
  const ui = await $.ui.mount(mountTarget(100))

  expect(await ui.find({ key: 'hide' })).toBeDefined()
  expect((await ui.find({ key: 'tab:1' }))?.text).toBe('1 Session')
  expect((await ui.find({ key: 'tab:4' }))?.text).toBe('4 Permissions')
  expect((await ui.find({ key: 'scope' }))?.text).toBe('[Session ⇄ History]')
  expect(await ui.find({ type: 'Text', text: /Agent tree/ })).toBeDefined()
  await ui.unmount()
})

test('pressing tab:3 sets the tab atom and renders Tools; a remount keeps it', async ($, on) => {
  const state = installState(on, { session: ready })
  const ui = await $.ui.mount(mountTarget(100))
  await ui.press({ key: 'tab:3' })

  expect(state.tab).toBe(3)
  expect(await ui.find({ type: 'Text', text: /Top Bash commands/ })).toBeDefined()
  await ui.unmount()

  const again = await $.ui.mount(mountTarget(100))
  expect(await again.find({ type: 'Text', text: /Top Bash commands/ })).toBeDefined()
  await again.unmount()
})

test('the scope toggle switches to History and shows the loading state', async ($, on) => {
  const state = installState(on, { tab: 2, session: ready })
  const ui = await $.ui.mount(mountTarget(100))
  await ui.press({ key: 'scope' })

  expect(state.scope).toBe('history')
  expect(await ui.find({ type: 'Text', text: /Loading history/ })).toBeDefined()
  await ui.unmount()
})

test('the scope toggle is absent on tab 5', async ($, on) => {
  installState(on, { tab: 5, session: ready })
  const ui = await $.ui.mount(mountTarget(100))

  expect(await ui.find({ key: 'scope' })).toBeUndefined()
  await ui.unmount()
})

test('the unfocused hint shows only while the pane lacks the keyboard', async ($, on) => {
  installState(on, { session: ready })
  const hint = /click a tab, or ctrl\+x tab, to use keys 1-5/

  const unfocused = await $.ui.mount(mountTarget(100, false))
  expect(await unfocused.find({ type: 'Text', text: hint })).toBeDefined()
  await unfocused.unmount()

  const focused = await $.ui.mount(mountTarget(100, true))
  expect(await focused.find({ type: 'Text', text: hint })).toBeUndefined()
  await focused.unmount()
})

test('only the digits 1 to 5 are hotkeys', async ($, on) => {
  installState(on, { session: ready })
  const ui = await $.ui.mount(mountTarget(100))
  const buttons = await ui.findAll({ type: 'Button' })

  expect(buttons.map(button => button.props.hotkey).filter(Boolean)).toEqual(['1', '2', '3', '4', '5'])
  await ui.unmount()
})

test('[✕ Hide] closes the pane by id', async ($, on) => {
  const closed: string[] = []
  installState(on, { session: ready })
  on('ui.close', (_, e) => {
    closed.push(e.id)
    return { value: undefined }
  })
  const ui = await $.ui.mount(mountTarget(100))
  await ui.press({ key: 'hide' })

  expect(closed).toEqual([PANE_ID])
  await ui.unmount()
})

test('tab labels follow the tier and the tab row wraps only when narrow', async ($, on) => {
  installState(on, { session: ready })
  const expected = { wide: '4 Permissions', medium: '4 Perm', narrow: '4 Perm' } as const
  for (const tier of ['wide', 'medium', 'narrow'] as const) {
    const ui = await $.ui.mount(mountTarget(WIDTHS[tier]))
    expect((await ui.find({ key: 'tab:4' }))?.text).toBe(expected[tier])
    const isWrapping = (await ui.findAll({ type: 'Box' })).some(box => box.props.flexWrap === 'wrap')
    expect(isWrapping).toBe(tier === 'narrow')
    await ui.unmount()
  }
})
