/** Plain function seams: `$` cannot be a value in a plugin, so the hook builds these inline. */
export type ObsDeps = {
  isOpen: () => boolean
  /** Persists the open flag; opening also loads the first figures and starts the timer, closing stops it. */
  setOpen: (open: boolean) => Promise<void>
}

/** Toggles the panel; the caller lets unknown arguments through. */
export async function handleObs(deps: ObsDeps): Promise<{ text: string; isTextDisplayOnly: true }> {
  const open = !deps.isOpen()
  try {
    await deps.setOpen(open)
  } catch {
    return { text: 'Observatory toggle failed.', isTextDisplayOnly: true }
  }
  return { text: open ? 'Observatory opened.' : 'Observatory closed.', isTextDisplayOnly: true }
}
