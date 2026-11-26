import { expect, test } from 'claude-code/testing'
import { sessionLines } from './tabs/session'
import { PLUGIN, SURFACE, agent, aggregate, context, installState, sessionAtomValue, sessionFigures, textOf } from './tabs/test-kit'

// These mount the band through the plugin, so they need registerBand wired into hooks/register.tsx.
const bandTarget = (bodyColumns: number, hasSurvey = false) =>
  ({
    plugin: PLUGIN,
    surface: SURFACE,
    component: 'AbovePrompt',
    props: {
      hasSurvey,
      isCollapsed: false,
      isWorking: false,
      maxRows: 5,
      bodyColumns,
      scroll: { offset: 0, bodyRows: 5 },
      view: {},
    },
  }) as const

const session = sessionAtomValue(sessionFigures([agent('a1'), agent('a2'), agent('a3')]), aggregate())

test('renders by default with zeros before the first data', async ($, on) => {
  installState(on)
  const ui = await $.ui.mount(bandTarget(80))
  expect(await ui.find({ type: 'Text', text: 'obs $0.00 · 0 tok · 0 agents' })).toBeDefined()
  await ui.unmount()
})

test('shows the session cost, tokens and agent count from the session atom', async ($, on) => {
  installState(on, { session })
  const ui = await $.ui.mount(bandTarget(80))
  expect(await ui.find({ type: 'Text', text: 'obs $0.50 · 5.0k tok · 3 agents' })).toBeDefined()
  expect(textOf(sessionLines(context('wide', { session })))).toContain('Tokens: 5.0k · Cost (est.): $0.50')
  await ui.unmount()
})

test('yields to a survey and draws nothing', async ($, on) => {
  installState(on, { session })
  const ui = await $.ui.mount(bandTarget(80, true))
  expect(await ui.find({ type: 'Text', text: /^obs / })).toBeUndefined()
  await ui.unmount()
})

test('draws nothing while bandEnabled is false', async ($, on) => {
  installState(on, { session, bandEnabled: false })
  const ui = await $.ui.mount(bandTarget(80))
  expect(await ui.find({ type: 'Text', text: /^obs / })).toBeUndefined()
  await ui.unmount()
})

test('truncates to the band width', async ($, on) => {
  installState(on, { session })
  const ui = await $.ui.mount(bandTarget(12))
  expect((await ui.find({ type: 'Text', text: /^obs / }))?.props.wrap).toBe('truncate-end')
  await ui.unmount()
})
