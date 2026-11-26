const EFFORT_ICONS: Readonly<Record<string, string>> = { low: '○', medium: '◔', high: '◑', xhigh: '◕', max: '●' }
const BUDGET_ICON = '◇'

/** Matches any effort icon, so the renderer can color it apart from the text around it. */
export const EFFORT_ICON_PATTERN = /([○◔◑◕●◇])/

/** `◔ medium` for a level, `◇ 8000` for a budget; empty when the agent took the session's effort. */
export function effortLabel(effort: string | number | null | undefined): string {
  if (effort === null || effort === undefined || effort === '') return ''
  if (typeof effort === 'number') return `${BUDGET_ICON} ${effort}`
  return `${EFFORT_ICONS[effort] ?? BUDGET_ICON} ${effort}`
}
