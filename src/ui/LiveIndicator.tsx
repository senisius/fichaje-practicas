import { useNow } from '../data/AppDataProvider'
import { MAX_SESSION_HOURS, WARN_OPEN_HOURS } from '../lib/limits'
import { formatDate, formatDuration, formatTime, HOUR_MS, MAX_SESSION_MS, madridDateKey } from '../lib/time'
import type { Session } from '../types'
import { IconMessage } from './icons'
import { Notice, Skeleton } from './Notice'
import './cards.css'

interface Props {
  studentName: string
  openSession: Session | null
  serverSkewMs: number
  loading: boolean
  onOpen: (sessionId: string) => void
}

/** Supervisora: estado en tiempo real del estudiante. */
export function LiveIndicator({ studentName, openSession, serverSkewMs, loading, onOpen }: Props) {
  const nowMs = useNow(1000) + serverSkewMs

  const startMs = openSession?.start_time.toMillis() ?? 0
  const elapsed = openSession ? Math.max(0, nowMs - startMs) : 0
  const sameDay = openSession ? madridDateKey(openSession.start_time) === madridDateKey(nowMs) : true
  const since = openSession
    ? sameDay
      ? formatTime(openSession.start_time)
      : `${formatDate(openSession.start_time)} ${formatTime(openSession.start_time)}`
    : ''
  // Para el lector de pantalla: "desde las 09:00" o "desde el lun 14/09/2026 a las 09:00"
  const sinceSpoken = openSession
    ? sameDay
      ? `desde las ${formatTime(openSession.start_time)}`
      : `desde el ${formatDate(openSession.start_time)} a las ${formatTime(openSession.start_time)}`
    : ''

  return (
    <section
      className={openSession ? 'card live-card is-running' : 'card live-card'}
      aria-labelledby="live-title"
      aria-busy={loading}
    >
      <div className="card-header">
        <h2 id="live-title" className="card-title">
          Ahora mismo
        </h2>
      </div>

      {/* Solo se anuncia el cambio de estado, no el contador. */}
      <p className="visually-hidden" aria-live="polite">
        {loading
          ? ''
          : openSession
            ? `${studentName} tiene una sesión en curso ${sinceSpoken}.`
            : `${studentName} no tiene ninguna sesión en curso.`}
      </p>

      {loading ? (
        <div className="stack" aria-hidden="true">
          <Skeleton width="75%" height={20} />
          <Skeleton width="40%" height={14} />
        </div>
      ) : openSession ? (
        <>
          <p className="live-line">
            <span className="status-dot is-live" aria-hidden="true" />
            <span>En curso desde {since}</span>
          </p>
          <p className="live-elapsed">
            {studentName} lleva <strong className="tabular">{formatDuration(elapsed)}</strong>
          </p>
          {elapsed > MAX_SESSION_MS ? (
            <Notice kind="warn" className="live-warn">
              Han pasado más de {MAX_SESSION_HOURS} h: ya no puede cerrarla con la hora actual y tendrá que indicar la
              hora real de fin. Ese tiempo no cuenta hasta entonces.
            </Notice>
          ) : (
            elapsed >= WARN_OPEN_HOURS * HOUR_MS && (
              <Notice kind="warn" className="live-warn">
                Lleva más de {WARN_OPEN_HOURS} h: puede que haya olvidado parar.
              </Notice>
            )
          )}
          <button type="button" className="btn btn-secondary btn-block" onClick={() => onOpen(openSession.id)}>
            <IconMessage size={18} />
            Ver la sesión y comentar
          </button>
        </>
      ) : (
        <p className="live-line">
          <span className="status-dot" aria-hidden="true" />
          <span>{studentName} no tiene ninguna sesión en curso</span>
        </p>
      )}
    </section>
  )
}
