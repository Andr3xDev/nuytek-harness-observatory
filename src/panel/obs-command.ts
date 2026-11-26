export type ObsCommand = 'toggle' | 'report' | 'other'

export const parseObsArgs = (args: string): ObsCommand => {
  const [first] = args.trim().split(/\s+/).filter(Boolean)
  if (first === undefined) return 'toggle'
  return first === 'report' ? 'report' : 'other'
}

export type ObsResult = { text: string; isTextDisplayOnly: true }

/** Plain function seams: `$` cannot be a value in a plugin, so the hook builds these inline. */
export type ObsDeps = {
  isOpen: () => boolean
  /** Persists the open flag; opening also loads the first figures and starts the timer, closing stops it. */
  setOpen: (open: boolean) => Promise<void>
}

const display = (text: string): ObsResult => ({ text, isTextDisplayOnly: true })

/** Toggles the panel; the caller routes `report` and unknown arguments. */
export async function handleObs(deps: ObsDeps): Promise<ObsResult> {
  if (deps.isOpen()) {
    await deps.setOpen(false)
    return display('Observatory closed.')
  }
  await deps.setOpen(true)
  return display('Observatory opened.')
}
