const THOUSAND = 1000
const MILLION = 1_000_000
const COMPACT_DECIMALS_LIMIT = 10

// The unit and the decimal form are chosen on the rounded value, so 9_999 is "10k" and 999_999 is "1.0M".
const compact = (value: number, suffix: string): string =>
  Math.round(value * 10) / 10 < COMPACT_DECIMALS_LIMIT ? `${value.toFixed(1)}${suffix}` : `${Math.round(value)}${suffix}`

export const formatTokens = (tokens: number): string => {
  const thousands = tokens / THOUSAND
  if (tokens >= MILLION || Math.round(thousands) >= THOUSAND) return compact(tokens / MILLION, 'M')
  if (tokens >= THOUSAND) return compact(thousands, 'k')
  return String(tokens)
}

const ELLIPSIS = '…'
const ISO_DAY_LENGTH = 'YYYY-MM-DD'.length

export const truncate = (text: string, width: number): string =>
  text.length <= width ? text : `${text.slice(0, Math.max(width - 1, 0))}${ELLIPSIS}`

/** UTC calendar day of a timestamp, `YYYY-MM-DD`. */
export const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, ISO_DAY_LENGTH)

export const formatUsd = (usd: number): string => `$${usd.toFixed(2)}`
