import { useState } from 'react'
import { useRevisions } from '../data/AppDataProvider'
import { formatDateTime } from '../lib/time'
import type { Session, SessionDoc } from '../types'
import { ErrorNotice, Notice, Skeleton } from './Notice'
import { describeChange, diffSession, missingRevisionsText, SNAPSHOT_FIELDS, showValue } from './revision-diff'

/** Historial de cambios de una sesión. Se vuelve a leer cuando cambia `rev` o al reintentar. */
export function RevisionHistory({ session }: { session: Session }) {
  const [attempt, setAttempt] = useState(0)
  return (
    <RevisionTimeline
      key={`${session.id}:${session.rev}:${attempt}`}
      session={session}
      onRetry={() => setAttempt((n) => n + 1)}
    />
  )
}

function RevisionTimeline({ session, onRetry }: { session: Session; onRetry: () => void }) {
  const { revisions, loading, error } = useRevisions(session.id)

  if (loading) {
    return (
      <div className="stack" aria-busy="true" aria-label="Cargando historial de cambios">
        <Skeleton width="60%" height={14} />
        <Skeleton width="85%" height={14} />
        <Skeleton width="40%" height={14} />
      </div>
    )
  }

  if (error) return <ErrorNotice title="No se ha podido cargar el historial" message={error} onRetry={onRetry} />

  const created = (
    <li className="timeline-item">
      <p className="timeline-head">
        <strong>{session.method === 'manual' ? 'Entrada manual registrada' : 'Fichaje iniciado'}</strong>
        <span className="muted">{formatDateTime(session.created_at)}</span>
      </p>
    </li>
  )

  return (
    <div className="stack">
      {revisions.length < session.rev && (
        <Notice kind="warn">{missingRevisionsText(session.rev, revisions.length)}</Notice>
      )}
      <ol className="timeline">
        {created}
        {revisions.map((r, i) => {
          const after: SessionDoc = i + 1 < revisions.length ? revisions[i + 1].before : session
          const changes = diffSession(r.before, after)
          return (
            <li key={r.id} className="timeline-item">
              <p className="timeline-head">
                <strong>
                  {i + 1}. {describeChange(r.before, after)}
                </strong>
                <span className="muted">{formatDateTime(r.at)}</span>
              </p>
              {changes.length === 0 ? (
                <p className="muted small">Sin diferencias visibles.</p>
              ) : (
                <ul className="changes">
                  {changes.map((c) =>
                    c.long ? (
                      <li key={c.key} className="change change-long">
                        <span className="change-label">{c.label}</span>
                        <span className="change-block change-before">
                          <span className="change-tag">Antes</span>
                          <del>{c.before}</del>
                        </span>
                        <span className="change-block change-after">
                          <span className="change-tag">Después</span>
                          <ins>{c.after}</ins>
                        </span>
                      </li>
                    ) : (
                      <li key={c.key} className="change">
                        <span className="change-label">{c.label}:</span>{' '}
                        <del className="change-old">{c.before}</del>
                        <span aria-hidden="true"> → </span>
                        <span className="visually-hidden"> pasa a </span>
                        <ins className="change-new">{c.after}</ins>
                      </li>
                    ),
                  )}
                </ul>
              )}
              <details className="snapshot">
                <summary>Ver el estado anterior completo</summary>
                <dl className="snapshot-grid">
                  {SNAPSHOT_FIELDS.map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd className="pre-wrap">{showValue(key, r.before[key])}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </li>
          )
        })}
      </ol>
      {revisions.length === 0 && <p className="muted small">Sin cambios desde que se registró.</p>}
    </div>
  )
}
