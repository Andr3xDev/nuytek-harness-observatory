// `$` cannot be a value: seams are built inline by the hook (see capture/handlers.ts).
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
