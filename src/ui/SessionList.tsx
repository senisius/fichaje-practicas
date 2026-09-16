import { useMemo, useState } from 'react'
import { useNow } from '../data/AppDataProvider'
import { computeFlags, formatDuration, formatWeekLabel, groupByWeek, type SessionFlags } from '../lib/time'
import type { Comment, Session } from '../types'
import { IconCalendar } from './icons'
import { EmptyState, Skeleton } from './Notice'
import { SessionFilters } from './SessionFilters'
import { FILTERS, matchesFilter, type SessionFilter } from './session-filters'
import { SessionRow } from './SessionRow'
import { plural } from './text'
import './sessions.css'

interface Props {
  sessions: Session[]
  commentsBySession: Map<string, Comment[]>
  serverSkewMs: number
  loading: boolean
  /** Texto del estado vacío según el rol. */
  emptyHint: string
  onSelect: (id: string) => void
  /** No se han podido cargar las sesiones: no se muestra la lista vacía como si fuera real. */
  failed?: boolean
}

const NO_COMMENTS: Comment[] = []

/** Historial agrupado por semana ISO, con filtros y marcas. */
export function SessionList({
  sessions,
  commentsBySession,
  serverSkewMs,
  loading,
  emptyHint,
  onSelect,
  failed = false,
}: Props) {
  // Las marcas tratan la sesión abierta como "terminando ahora": con precisión de minuto basta.
  const nowMs = useNow(60_000) + serverSkewMs
  const [filter, setFilter] = useState<SessionFilter>('all')

  const flags = useMemo(
    () => (loading ? new Map<string, SessionFlags>() : computeFlags(sessions, nowMs)),
    [loading, sessions, nowMs],
  )
  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])

  const counts = useMemo(() => {
    const c = Object.fromEntries(FILTERS.map((f) => [f.key, 0])) as Record<SessionFilter, number>
    for (const s of sessions) {
      for (const f of FILTERS) if (matchesFilter(f.key, s, flags.get(s.id))) c[f.key]++
    }
    return c
  }, [sessions, flags])

  const filtered = useMemo(
    () => (filter === 'all' ? sessions : sessions.filter((s) => matchesFilter(filter, s, flags.get(s.id)))),
    [filter, sessions, flags],
  )
  const weeks = useMemo(() => (loading ? [] : groupByWeek(filtered)), [loading, filtered])
  // El total de la semana es siempre el de todas sus sesiones válidas, aunque haya un filtro.
  const weekTotals = useMemo(
    () => (loading ? new Map<string, number>() : new Map(groupByWeek(sessions).map((w) => [w.weekStart, w.validMs]))),
    [loading, sessions],
  )

  return (
    <section className="card history" aria-labelledby="history-title" aria-busy={loading}>
      <div className="card-header">
        <h2 id="history-title" className="card-title">
          Historial
        </h2>
        {!loading && !failed && <span className="card-meta">{plural(sessions.length, 'sesión', 'sesiones')}</span>}
      </div>

      {!loading && !failed && sessions.length > 0 && (
        <SessionFilters value={filter} counts={counts} onChange={setFilter} />
      )}

      <p className="visually-hidden" aria-live="polite">
        {!loading && filter !== 'all' ? `Mostrando ${plural(filtered.length, 'sesión', 'sesiones')}` : ''}
      </p>

      {loading ? (
        <SessionListSkeleton />
      ) : failed ? (
        <EmptyState icon={<IconCalendar size={26} />} title="No se ha podido cargar el historial">
          Recarga la página para volver a intentarlo.
        </EmptyState>
      ) : sessions.length === 0 ? (
        <EmptyState icon={<IconCalendar size={26} />} title="Aún no hay sesiones">
          {emptyHint}
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<IconCalendar size={26} />} title="Ninguna sesión con este filtro">
          <button type="button" className="btn btn-link" onClick={() => setFilter('all')}>
            Ver todas
          </button>
        </EmptyState>
      ) : (
        weeks.map((w) => {
          const headingId = `week-${w.weekStart}`
          const total = weekTotals.get(w.weekStart) ?? w.validMs
          return (
            <section key={w.weekStart} className="week" aria-labelledby={headingId}>
              <div className="week-header">
                <h3 id={headingId} className="week-title">
                  {formatWeekLabel(w.weekStart)}
                </h3>
                <p className="week-total">
                  {/* Con un filtro, la etiqueta se ve: el total es el de toda la semana, no el de las filas filtradas */}
                  <span className={filter === 'all' ? 'visually-hidden' : 'week-total-label'}>
                    {filter === 'all' ? 'Total válido: ' : 'Total válido de la semana: '}
                  </span>
                  {formatDuration(total)}
                </p>
              </div>
              <ul className="session-list">
                {w.sessions.map((s) => (
                  <li key={s.id}>
                    <SessionRow
                      session={s}
                      flags={flags.get(s.id)}
                      commentCount={(commentsBySession.get(s.id) ?? NO_COMMENTS).length}
                      skewMs={serverSkewMs}
                      sessionsById={sessionsById}
                      onSelect={onSelect}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}
      {!loading && !failed && sessions.length > 0 && (
        <p className="muted small history-footnote">
          Cada sesión se muestra en minutos completos; los totales de cada semana suman el tiempo exacto (con segundos)
          de las sesiones válidas, así que pueden tener algún minuto más que la suma de las filas.
        </p>
      )}
    </section>
  )
}

function SessionListSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="week-header">
        <Skeleton width={160} height={14} />
        <Skeleton width={80} height={14} />
      </div>
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="session-row session-row-skeleton">
          <Skeleton width={36} height={36} />
          <div className="session-main">
            <Skeleton width="55%" height={16} />
            <Skeleton width="35%" height={14} />
            <Skeleton width="45%" height={18} />
          </div>
        </div>
      ))}
    </div>
  )
}
