import { truncate } from '../core/format'

export type Tier = 'wide' | 'medium' | 'narrow'

export const TIER_WIDE_MIN = 70
export const TIER_MEDIUM_MIN = 45
export const LIST_ROW_CAP = 20
export const BASH_ROW_CAP = 10

/** The hotkey Button draws its own `1: ` prefix, so labels carry no digit. */
export const TAB_LABELS = ['Session', 'Agents', 'Tools', 'Permissions', 'History'] as const

export const tierOf = (bodyColumns: number): Tier =>
  bodyColumns >= TIER_WIDE_MIN ? 'wide' : bodyColumns >= TIER_MEDIUM_MIN ? 'medium' : 'narrow'

// Name column left-aligned and truncated; numeric columns right-aligned.
export const formatRow = (cells: readonly string[], widths: readonly number[]): string =>
  cells
    .map((cell, index) => {
      const width = widths[index] ?? cell.length
      return index === 0 ? truncate(cell, width).padEnd(width) : cell.padStart(width)
    })
    .join(' ')

export const capRows = (rows: readonly string[], cap: number): string[] =>
  rows.length <= cap ? [...rows] : [...rows.slice(0, cap), `+${rows.length - cap} more`]
