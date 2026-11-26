import type { Register, On, PluginOptions } from 'claude-code'
import { CLASSIC_PERMISSION_HOOKS_ENABLED } from '../src/capture/flags'
import { createPluginCapture, registerCapture } from '../src/capture/register'
import { createPanel, registerPanel } from '../src/panel/register'

/** `classicPermissionHooks` is a parameter so tests can exercise both flag states. */
export const registerHooks = (on: On, options: PluginOptions, classicPermissionHooks: boolean): void => {
  const capture = createPluginCapture(options)
  const panel = createPanel(capture)
  registerCapture(on, capture, classicPermissionHooks, panel.safeRefresh)
  registerPanel(on, capture, panel)
}

export const register: Register = (on, options) =>
  registerHooks(on, options, CLASSIC_PERMISSION_HOOKS_ENABLED)
