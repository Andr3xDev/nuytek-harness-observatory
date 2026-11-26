import { atom, read } from 'claude-code'
import type { On } from 'claude-code'
import { formatBandLine } from '../core/format'
import { emptyFigure, type SessionFigures } from '../core/figures'
import { STATE_SHAPES } from './state'

// The hooks scan reads state refs only from literals or atoms declared in the reading file (see pane.tsx).
const sessionAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'session' } as const, null, { shape: STATE_SHAPES.session })
const bandEnabledAtom = atom({ plugin: 'nuytek-harness-observatory', key: 'bandEnabled' } as const, true, { shape: STATE_SHAPES.bandEnabled })

export function registerBand(on: On) {
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const [enabled, session] = await Promise.all([read($, bandEnabledAtom), read($, sessionAtom)])
    if (!enabled || e.props.hasSurvey) return next(e)
    const { Text } = $.ui.resolve(e)
    const figures = session ? (session.sessionFigures as SessionFigures) : { total: emptyFigure(), agents: [] }
    return <Text wrap="truncate-end">{formatBandLine(figures)}</Text>
  })
}
