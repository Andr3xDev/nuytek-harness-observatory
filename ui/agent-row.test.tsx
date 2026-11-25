import { expect, test } from 'claude-code/testing'
import { agent, aggregate, installState, mountTarget, sessionAtomValue, sessionFigures } from './tabs/test-kit'

// These mount the pane through the plugin, so they need the panel wired into hooks/register.tsx (task 4.2).
const agents = [agent('live1', { subagentType: 'builder' }), agent('gone1', { subagentType: 'reviewer' })]
const seeded = (liveAgentIds: string[]) => sessionAtomValue(sessionFigures(agents), aggregate(), liveAgentIds)

test('a live agent row is a Button that views that agent; a stored-only row is not', async ($, on) => {
  const viewed: Array<string | undefined> = []
  let hostListCalls = 0
  installState(on, { session: seeded(['live1']) })
  on('ui.view', (_, e) => {
    viewed.push(e.agentId)
    return { value: {} }
  })
  on('agent.list', () => {
    hostListCalls += 1
    return { value: [] }
  })
  const ui = await $.ui.mount(mountTarget(100))

  expect(await ui.find({ key: 'agent:gone1' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /reviewer/ })).toBeDefined()
  await ui.press({ key: 'agent:live1' })

  expect(viewed).toEqual(['live1'])
  expect(hostListCalls).toBe(0)
  await ui.unmount()
})

test('the Agents tab rows follow the same rule', async ($, on) => {
  installState(on, { tab: 2, session: seeded(['live1']) })
  const ui = await $.ui.mount(mountTarget(100))

  expect(await ui.find({ key: 'agent:live1' })).toBeDefined()
  expect(await ui.find({ key: 'agent:gone1' })).toBeUndefined()
  await ui.unmount()
})

test('a denied view shows a toast and the pane stays drawn', async ($, on) => {
  const toasts: string[] = []
  installState(on, { session: seeded(['live1']) })
  on('ui.view', () => ({ value: { deny: 'not now' } }))
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const ui = await $.ui.mount(mountTarget(100))
  await ui.press({ key: 'agent:live1' })

  expect(toasts).toEqual(['not now'])
  expect(await ui.find({ key: 'tab:1' })).toBeDefined()
  await ui.unmount()
})
