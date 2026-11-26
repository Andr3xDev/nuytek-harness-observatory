import { atom, read } from 'claude-code'
import type { On } from 'claude-code'
import { formatBandLine } from '../core/format'
import type { Figure, SessionFigures } from '../report/analysis'
import { STATE_SHAPES } from './state'

// The hooks scan reads state refs only from literals or atoms declared in the reading file (see pane.tsx).
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })

const NO_USAGE: Figure = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, tokens: 0, costUsd: 0, hasUnknownPrice: false }

export function registerBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [enabled, session] = await Promise.all([read($, bandEnabledAtom), read($, sessionAtom)])
    if (!enabled || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    const figures = session ? (session.sessionFigures as SessionFigures) : { total: NO_USAGE, agents: [] }
    return <Text wrap="truncate-end">{formatBandLine(figures)}</Text>
  })
}
