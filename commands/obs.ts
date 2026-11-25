export type ObsCommand = 'toggle' | 'band-on' | 'band-off' | 'band-usage' | 'other'

export const parseObsArgs = (args: string): ObsCommand => {
  const [first, second, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (first === undefined) return 'toggle'
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

/** Resolves `null` for arguments that are not ours (`report`, unknown): the caller passes them to `next(e)`. */
export async function handleObs(command: ObsCommand, deps: ObsDeps): Promise<ObsResult | null> {
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
    case 'other':
      return null
  }
}
