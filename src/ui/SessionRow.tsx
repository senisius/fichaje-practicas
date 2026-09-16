import { memo, useId } from 'react'
import { useNow } from '../data/AppDataProvider'
import { DAY_WARN_HOURS } from '../lib/limits'
import { durationMs, formatDate, formatDuration, sessionStatus, type SessionFlags } from '../lib/time'
import type { Session } from '../types'
import { IconChevronRight, IconMessage, IconPencil, IconStopwatch } from './icons'
import { otherSessionLabel, scheduleLabel } from './session-labels'
import { plural, truncateText } from './text'

interface Props {
  session: Session
  flags: SessionFlags | undefined
  commentCount: number
  /** Desfase del reloj (hora servidor - hora cliente) para la duración de la sesión en curso. */
  skewMs: number
  sessionsById: Map<string, Session>
  onSelect: (id: string) => void
}

/** Largo máximo de la nota en la descripción accesible de la fila (la nota entera está en el detalle). */
const NOTE_PREVIEW_CHARS = 80

/** Duración de la sesión en curso, al segundo (igual que el cronómetro de la tarjeta). */
function OpenDuration({ startMs, skewMs }: { startMs: number; skewMs: number }) {
  const nowMs = useNow(1000)
  return <>{formatDuration(Math.max(0, nowMs + skewMs - startMs))}</>
}

function SessionRowImpl({ session, flags, commentCount, skewMs, sessionsById, onSelect }: Props) {
  const status = sessionStatus(session)
  const open = status === 'en_curso'
  const voided = status === 'anulada'
  const MethodIcon = session.method === 'live' ? IconStopwatch : IconPencil
  const baseId = useId()
  const ids = { line: `${baseId}-l`, sub: `${baseId}-s`, tags: `${baseId}-t`, note: `${baseId}-n` }

  const overlaps = flags?.overlapsWith ?? []
  const firstOverlap = overlaps.length > 0 ? sessionsById.get(overlaps[0]) : undefined

  return (
    // Nombre accesible corto (fecha, duración, horario y etiquetas); la nota va como descripción recortada
    <button
      type="button"
      className={`session-row${voided ? ' is-voided' : ''}${open ? ' is-open' : ''}`}
      onClick={() => onSelect(session.id)}
      aria-labelledby={`${ids.line} ${ids.sub} ${ids.tags}`}
      aria-describedby={session.note ? ids.note : undefined}
    >
      <span className={`method-icon${session.method === 'manual' ? ' is-manual' : ''}`} aria-hidden="true">
        <MethodIcon size={18} />
      </span>

      <span className="session-main">
        <span className="session-line" id={ids.line}>
          <span className="session-date">{formatDate(session.start_time)}</span>
          <span className="session-duration">
            {voided && <span className="visually-hidden">Anulada: </span>}
            {open ? (
              <OpenDuration startMs={session.start_time.toMillis()} skewMs={skewMs} />
            ) : (
              formatDuration(durationMs(session))
            )}
          </span>
        </span>

        <span className="session-line session-line-sub" id={ids.sub}>
          <span className="session-time">{scheduleLabel(session)}</span>
        </span>

        <span className="tags" id={ids.tags}>
          {open ? (
            <span className="tag tag-brand">
              <span className="status-dot is-live" aria-hidden="true" />
              en curso
            </span>
          ) : null}
          <span className={session.method === 'live' ? 'tag' : 'tag tag-info'}>
            {session.method === 'live' ? 'en vivo' : 'manual'}
          </span>
          {voided && <span className="tag tag-danger">anulada</span>}
          {session.adjusted && <span className="tag tag-warn">fin ajustado</span>}
          {flags && flags.editCount > 0 && <span className="tag">nota editada ({flags.editCount})</span>}
          {flags && flags.lateDays !== null && (
            <span className="tag tag-warn">
              registrada {plural(Math.floor(flags.lateDays), 'día', 'días')} después
            </span>
          )}
          {overlaps.length > 0 && (
            <span className="tag tag-warn">
              solapa con {firstOverlap ? otherSessionLabel(firstOverlap, session) : 'otra sesión'}
              {overlaps.length > 1 ? ` y ${overlaps.length - 1} más` : ''}
            </span>
          )}
          {flags?.dayOverLimit && <span className="tag tag-warn">día &gt; {DAY_WARN_HOURS} h</span>}
          {commentCount > 0 && (
            <span className="tag tag-brand">
              <IconMessage size={12} />
              <span aria-hidden="true">{commentCount}</span>
              <span className="visually-hidden">{plural(commentCount, 'comentario', 'comentarios')}</span>
            </span>
          )}
        </span>

        {session.note && (
          <>
            <span className="session-note" aria-hidden="true">
              {session.note}
            </span>
            <span className="visually-hidden" id={ids.note}>
              Nota: {truncateText(session.note, NOTE_PREVIEW_CHARS)}
            </span>
          </>
        )}
      </span>

      <IconChevronRight className="session-chevron" size={18} />
    </button>
  )
}

export const SessionRow = memo(SessionRowImpl)
