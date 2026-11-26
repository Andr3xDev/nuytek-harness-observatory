import { truncate } from '../core/format'

export type Tier = 'wide' | 'medium' | 'narrow'

const TIER_WIDE_MIN = 70
const TIER_MEDIUM_MIN = 45
export const LIST_ROW_CAP = 20

/** The hotkey Button draws its own `1: ` prefix, so labels carry no digit. */
export const TAB_LABELS = ['Session', 'Agents', 'Tools', 'History'] as const

export const tierOf = (bodyColumns: number): Tier =>
  bodyColumns >= TIER_WIDE_MIN ? 'wide' : bodyColumns >= TIER_MEDIUM_MIN ? 'medium' : 'narrow'

/** Theme keys, so each color follows the person's light or dark theme. */
export const PALETTE = {
  brand: 'claude',
  heading: 'claude',
  cost: 'success',
  tokens: 'suggestion',
  failure: 'error',
  effort: 'remember',
  border: 'subtle',
} as const

/** The panel box costs one border cell and one padding cell on each side. */
export const BOX_CHROME_COLUMNS = 4

/** Single-width so `repeat(columns)` fills the row exactly. */
export const SECTION_RULE = '─'

/** Table column divider; the renderer splits rows on it to draw the `│` dim. */
export const COLUMN_SEPARATOR = ' │ '

export const formatRow = (cells: readonly string[], widths: readonly number[], separator = ' '): string =>
  cells
    .map((cell, index) => {
      const width = widths[index] ?? cell.length
      return index === 0 ? truncate(cell, width).padEnd(width) : cell.padStart(width)
    })
    .join(separator)
