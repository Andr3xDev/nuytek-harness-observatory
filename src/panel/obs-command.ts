export type ObsCommand = 'toggle' | 'band-on' | 'band-off' | 'band-usage' | 'report' | 'other'

export const parseObsArgs = (args: string): ObsCommand => {
  const [first, second, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (first === undefined) return 'toggle'
  if (first === 'report') return 'report'
  if (first !== 'band' || rest.length > 0) return 'other'
  if (second === 'on') return 'band-on'
  if (second === 'off') return 'band-off'
  return 'band-usage'
}

export type ObsResult = { text: string; isTextDisplayOnly: true }

/** Plain function seams: `$` cannot be a value in a plugin, so the hook builds these inline. */
export type ObsDeps = {
  isPaneOpen: () => Promise<boolean>
  closePane: () => Promise<void>
  /** Opens the pane focused with Esc-to-close; resolves the engine's placement answer. */
  openPane: () => Promise<{ isPlaced: true } | { isPlaced: false; reason: string }>
  resetScope: () => Promise<void>
  /** Called once the pane is placed: loads the first figures and starts the 5 s timer. */
  onOpened: () => void
  setBandEnabled: (enabled: boolean) => Promise<void>
}

const BAND_USAGE_TEXT = 'Usage: /obs band on|off'
const display = (text: string): ObsResult => ({ text, isTextDisplayOnly: true })

async function toggle(deps: ObsDeps): Promise<ObsResult> {
  if (await deps.isPaneOpen()) {
    await deps.closePane()
    return display('Observatory closed.')
  }
  await deps.resetScope()
  const opened = await deps.openPane()
  if (!opened.isPlaced) return display(`Observatory not shown: ${opened.reason}`)
  deps.onOpened()
  return display('Observatory opened.')
}

export type PaneCommand = Exclude<ObsCommand, 'report' | 'other'>

/** Answers the pane commands; the caller routes `report` and unknown arguments. */
export async function handleObs(command: PaneCommand, deps: ObsDeps): Promise<ObsResult> {
  switch (command) {
    case 'toggle':
      return toggle(deps)
    case 'band-on':
    case 'band-off': {
      const enabled = command === 'band-on'
      await deps.setBandEnabled(enabled)
      return display(`Band ${enabled ? 'on' : 'off'}.`)
    }
    case 'band-usage':
      return display(BAND_USAGE_TEXT)
  }
}
