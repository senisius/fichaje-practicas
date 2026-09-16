import { useMemo } from 'react'
import { useNow } from '../data/AppDataProvider'
import { MAX_SESSION_HOURS } from '../lib/limits'
import { displayPct, displayRemainingMs, estimateFinish, formatDate, formatDuration, progress } from '../lib/time'
import type { Session } from '../types'
import { IconCheckCircle, IconClock } from './icons'
import { Notice, Skeleton } from './Notice'
import { formatHours, formatPct, plural } from './text'
import './cards.css'

interface Props {
  title: string
  sessions: Session[]
  targetHours: number
  openSession: Session | null
  serverSkewMs: number
  loading: boolean
  /** Inicio de las prácticas (ms), para que el ritmo del primer mes no cuente semanas anteriores. */
  programStartMs?: number | null
  /** No se han podido cargar las sesiones: no se muestran cifras. */
  failed?: boolean
}

export function ProgressCard({
  title,
  sessions,
  targetHours,
  openSession,
  serverSkewMs,
  loading,
  programStartMs = null,
  failed = false,
}: Props) {
  // Con sesión abierta, el "+ en curso" se refresca cada segundo; si no, basta cada minuto.
  const nowMs = useNow(openSession ? 1000 : 60_000)
  const p = useMemo(
    () => (loading || failed ? null : progress(sessions, targetHours, openSession, nowMs, serverSkewMs)),
    [loading, failed, sessions, targetHours, openSession, nowMs, serverSkewMs],
  )
  // La fecha estimada solo depende de las sesiones cerradas: no hace falta recalcularla cada segundo.
  const minuteKey = Math.floor(nowMs / 60_000)
  const remainingMs = p?.remainingMs ?? 0
  const finish = useMemo(
    () => (loading || failed ? null : estimateFinish(sessions, remainingMs, minuteKey * 60_000, programStartMs)),
    [loading, failed, sessions, remainingMs, minuteKey, programStartMs],
  )

  if (failed) {
    return (
      <section className="card" aria-labelledby="progress-title">
        <div className="card-header">
          <h2 id="progress-title" className="card-title">
            {title}
          </h2>
        </div>
        <Notice kind="error" title="No se han podido cargar las horas">
          <p>Recarga la página para volver a intentarlo.</p>
        </Notice>
      </section>
    )
  }

  // Cifras a la vista: lo hecho se trunca al minuto y lo restante se redondea hacia arriba, así cuadran
  const pct = p ? displayPct(p) : 0
  const remainingShown = p ? displayRemainingMs(p) : 0

  return (
    <section className="card" aria-labelledby="progress-title" aria-busy={loading}>
      <div className="card-header">
        <h2 id="progress-title" className="card-title">
          {title}
        </h2>
        {p && <span className="card-meta">{plural(p.validCount, 'sesión válida', 'sesiones válidas')}</span>}
      </div>

      {!p ? (
        <ProgressSkeleton />
      ) : (
        <>
          <div className="progress-hero">
            <span className="progress-done">{formatDuration(p.doneMs)}</span>
            <span className="progress-target">de {formatHours(targetHours)}</span>
            <span className="progress-pct">{formatPct(pct)}</span>
          </div>

          <div
            className="progress-bar"
            role="progressbar"
            aria-label="Horas completadas"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-valuetext={`${formatPct(pct)}: ${formatDuration(p.doneMs)} de ${formatHours(targetHours)}`}
          >
            <div className="progress-fill" style={{ width: `${p.pct}%` }} />
            {p.liveMs > 0 && p.targetMs > 0 && !p.liveOverMax && (
              <div
                className="progress-live"
                style={{ width: `${Math.min(100 - p.pct, (p.liveMs / p.targetMs) * 100)}%` }}
              />
            )}
          </div>

          {openSession && (
            <p className="progress-open">
              <IconClock size={16} />
              {p.liveOverMax ? (
                <>
                  <span className="tabular">+ más de {MAX_SESSION_HOURS} h en curso</span>
                  <span className="muted">(no cuentan hasta indicar la hora de fin)</span>
                </>
              ) : (
                <>
                  <span className="tabular">+ {formatDuration(p.liveMs)} en curso</span>
                  <span className="muted">(cuenta al parar)</span>
                </>
              )}
            </p>
          )}

          {p.remainingMs === 0 && (
            <p className="goal-reached">
              <IconCheckCircle />
              Objetivo de horas alcanzado
            </p>
          )}

          <dl className="stats">
            <div className="stat">
              <dt>Restante</dt>
              <dd>{formatDuration(remainingShown)}</dd>
            </div>
            <div className="stat">
              <dt>Fin estimado</dt>
              <dd>
                {p.remainingMs === 0 ? '—' : finish ? formatDate(finish) : <span className="muted">sin ritmo reciente</span>}
              </dd>
            </div>
            <div className="stat">
              <dt>Fichaje en vivo</dt>
              <dd>{formatDuration(p.liveMethodMs)}</dd>
            </div>
            <div className="stat">
              <dt>Entradas manuales</dt>
              <dd>{formatDuration(p.manualMs)}</dd>
            </div>
            <div className="stat stat-wide">
              <dt>Con fin ajustado</dt>
              <dd>{plural(p.adjustedCount, 'sesión', 'sesiones')}</dd>
            </div>
          </dl>
          <p className="muted small progress-footnote">
            Las cifras se muestran sin segundos: el desglose puede sumar un minuto menos que el total, que cuenta el
            tiempo exacto.
          </p>
        </>
      )}
    </section>
  )
}

function ProgressSkeleton() {
  return (
    <div className="stack">
      <Skeleton width="60%" height={32} />
      <Skeleton height={12} />
      <div className="stats">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="stack" style={{ gap: 6 }}>
            <Skeleton width="50%" height={12} />
            <Skeleton width="80%" height={16} />
          </div>
        ))}
      </div>
    </div>
  )
}
