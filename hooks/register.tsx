import type { Register, On, PluginOptions } from 'claude-code'
import { createPluginCapture, registerCapture } from '../src/capture/register'
import { createPanel, registerPanel } from '../src/panel/register'

export const registerHooks = (on: On, options: PluginOptions): void => {
  const capture = createPluginCapture(options)
  const panel = createPanel(capture)
  registerCapture(on, capture, panel.safeRefresh)
  registerPanel(on, capture, panel)
}

export const register: Register = (on, options) => registerHooks(on, options)
