export type ObsCommand = 'toggle' | 'band-on' | 'band-off' | 'band-usage' | 'other'

export const parseObsArgs = (args: string): ObsCommand => {
  const [first, second, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (first === undefined) return 'toggle'
  if (first !== 'band' || rest.length > 0) return 'other'
  if (second === 'on') return 'band-on'
  if (second === 'off') return 'band-off'
  return 'band-usage'
}
