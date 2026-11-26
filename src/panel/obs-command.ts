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
  isOpen: () => boolean
  /** Persists the open flag; opening also loads the first figures and starts the timer, closing stops it. */
  setOpen: (open: boolean) => Promise<void>
  resetScope: () => Promise<void>
  setBandEnabled: (enabled: boolean) => Promise<void>
}

const BAND_USAGE_TEXT = 'Usage: /obs band on|off'
const display = (text: string): ObsResult => ({ text, isTextDisplayOnly: true })

async function toggle(deps: ObsDeps): Promise<ObsResult> {
  if (deps.isOpen()) {
    await deps.setOpen(false)
    return display('Observatory closed.')
  }
  await deps.resetScope()
  // An open panel inside a hidden band would draw nothing.
  await deps.setBandEnabled(true)
  await deps.setOpen(true)
  return display('Observatory opened.')
}

export type PanelCommand = Exclude<ObsCommand, 'report' | 'other'>

/** Answers the panel commands; the caller routes `report` and unknown arguments. */
export async function handleObs(command: PanelCommand, deps: ObsDeps): Promise<ObsResult> {
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
