import { expect, test } from 'claude-code/testing'
import { WIDTHS, agent, aggregate, bandTarget, installState, sessionAtomValue, sessionFigures } from './tabs/test-kit'

// These mount the band through the plugin, so they need registerBand wired into hooks/register.tsx.
const session = sessionAtomValue(sessionFigures([agent('a1'), agent('a2'), agent('a3')]), aggregate())
const CLOSED_LINE = /^◆ obs /

test('closed: zeros before the first data', async ($, on) => {
  installState(on)
  const ui = await $.ui.mount(bandTarget(80))
  expect(await ui.find({ type: 'Text', text: '◆ obs  $0.00 · ◈ 0 tok · ▸ 0 agents' })).toBeDefined()
  await ui.unmount()
})

test('closed: shows the session cost, tokens and agent count, truncated to the band width', async ($, on) => {
  installState(on, { session })
  const ui = await $.ui.mount(bandTarget(12))
  const line = await ui.find({ type: 'Text', text: '◆ obs  $0.50 · ◈ 5.0k tok · ▸ 3 agents' })
  expect(line?.props.wrap).toBe('truncate-end')
  expect(await ui.find({ key: 'tab:1' })).toBeUndefined()
  await ui.unmount()
})

test('yields to a survey and draws nothing', async ($, on) => {
  installState(on, { session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(80, true))
  expect(await ui.find({ type: 'Text', text: CLOSED_LINE })).toBeUndefined()
  expect(await ui.find({ key: 'tab:1' })).toBeUndefined()
  await ui.unmount()
})

test('draws nothing while bandEnabled is false', async ($, on) => {
  installState(on, { session, bandEnabled: false, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(80))
  expect(await ui.find({ type: 'Text', text: CLOSED_LINE })).toBeUndefined()
  expect(await ui.find({ key: 'tab:1' })).toBeUndefined()
  await ui.unmount()
})

test('open: tab row, scope toggle and the active tab at full width', async ($, on) => {
  installState(on, { session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(100))

  expect(await ui.find({ type: 'Text', text: CLOSED_LINE })).toBeUndefined()
  expect((await ui.find({ key: 'tab:1' }))?.text).toBe('Session')
  expect((await ui.find({ key: 'tab:4' }))?.text).toBe('Permissions')
  expect((await ui.find({ key: 'scope' }))?.text).toBe('[Session ⇄ History]')
  expect(await ui.find({ type: 'Text', text: /Agent tree/ })).toBeDefined()
  await ui.unmount()
})

test('pressing tab:3 sets the tab atom and renders Tools; a remount keeps it', async ($, on) => {
  const state = installState(on, { session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(100))
  await ui.press({ key: 'tab:3' })

  expect(state.tab).toBe(3)
  expect(await ui.find({ type: 'Text', text: /Top Bash commands/ })).toBeDefined()
  await ui.unmount()

  const again = await $.ui.mount(bandTarget(100))
  expect(await again.find({ type: 'Text', text: /Top Bash commands/ })).toBeDefined()
  await again.unmount()
})

test('the scope toggle switches to History and shows the loading state', async ($, on) => {
  const state = installState(on, { tab: 2, session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(100))
  await ui.press({ key: 'scope' })

  expect(state.scope).toBe('history')
  expect(await ui.find({ type: 'Text', text: /Loading history/ })).toBeDefined()
  await ui.unmount()
})

test('the scope toggle is absent on tab 5', async ($, on) => {
  installState(on, { tab: 5, session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(100))

  expect(await ui.find({ key: 'scope' })).toBeUndefined()
  await ui.unmount()
})

test('only the digits 1 to 5 are hotkeys', async ($, on) => {
  installState(on, { session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(100))
  const buttons = await ui.findAll({ type: 'Button' })

  expect(buttons.map(button => button.props.hotkey).filter(Boolean)).toEqual(['1', '2', '3', '4', '5'])
  await ui.unmount()
})

test('the tab row wraps so a narrow band keeps every tab', async ($, on) => {
  installState(on, { session, panelOpen: true })
  const ui = await $.ui.mount(bandTarget(WIDTHS.narrow))
  expect((await ui.findAll({ type: 'Box' })).some(box => box.props.flexWrap === 'wrap')).toBe(true)
  expect(await ui.find({ key: 'tab:5' })).toBeDefined()
  await ui.unmount()
})
