import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Timestamp } from 'firebase/firestore'
import { useAppData, useNow } from '../data/AppDataProvider'
import { DAY_WARN_HOURS, LATE_FLAG_HOURS, MAX_SESSION_HOURS } from '../lib/limits'
import {
  MAX_SESSION_MS,
  computeFlags,
  durationMs,
  formatDate,
  formatDateTime,
  formatDuration,
  sessionStatus,
} from '../lib/time'
import type { AppUser, Comment, Session } from '../types'
import { CommentForm } from './CommentForm'
import { IDLE, type FormActivity } from './form-activity'
import { IconBan, IconHistory, IconMessage, IconPencil } from './icons'
import { Modal } from './Modal'
import { NoteEditor } from './NoteEditor'
import { Notice, Skeleton } from './Notice'
import { RevisionHistory } from './RevisionHistory'
import { scheduleLabel } from './session-labels'
import { methodLabel, plural, statusLabel } from './text'
import { VoidDialog } from './VoidDialog'
import './detail.css'

interface Props {
  sessionId: string
  user: AppUser
  online: boolean
  onClose: () => void
  /** Abre otra sesión (p. ej. una que se solapa) en el mismo panel. */
  onSelect: (id: string) => void
}

export function SessionDetail({ sessionId, user, online, onClose, onSelect }: Props) {
  const { sessions, loading } = useAppData()
  const session = sessions.find((s) => s.id === sessionId) ?? null
  // Si se navega a otra sesión dentro del panel, el foco va a su contenido.
  const [firstId] = useState(sessionId)
  // Formularios del panel (nota o comentario): con texto sin guardar se pide confirmación antes de
  // cerrar o de cambiar de sesión, y con un guardado pendiente no se puede cerrar.
  const [activity, setActivity] = useState<FormActivity>(IDLE)
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null)
  const onActivity = useCallback(
    (a: FormActivity) => setActivity((prev) => (prev.dirty === a.dirty && prev.busy === a.busy ? prev : a)),
    [setActivity],
  )

  const guard = (action: () => void) => {
    if (activity.busy) return
    if (activity.dirty) setPendingAction(() => action)
    else action()
  }

  return (
    <Modal
      wide
      title={session ? `Sesión del ${formatDate(session.start_time)}` : 'Sesión'}
      onClose={() => guard(onClose)}
      busy={activity.busy}
      dismissOnBackdrop={!activity.dirty}
    >
      {session ? (
        <SessionDetailBody
          key={session.id}
          session={session}
          user={user}
          online={online}
          focusOnMount={session.id !== firstId}
          onSelect={(id) => guard(() => onSelect(id))}
          onActivity={onActivity}
        />
      ) : loading ? (
        <div className="stack" aria-busy="true">
          <Skeleton width="40%" height={28} />
          <Skeleton height={80} />
        </div>
      ) : (
        <Notice kind="warn" title="No se encuentra esta sesión">
          <p>Puede que ya no esté disponible. Cierra el panel y vuelve a intentarlo.</p>
        </Notice>
      )}
      {pendingAction && (
        <Modal
          role="alertdialog"
          title="¿Descartar el texto sin guardar?"
          description="Lo que has escrito en este panel todavía no se ha guardado."
          onClose={() => setPendingAction(null)}
          footer={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => setPendingAction(null)}>
                Seguir escribiendo
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => {
                  const action = pendingAction
                  setPendingAction(null)
                  setActivity(IDLE)
                  action()
                }}
              >
                Descartar
              </button>
            </>
          }
        >
          <p>Si lo descartas, se perderá.</p>
        </Modal>
      )}
    </Modal>
  )
}

interface BodyProps {
  session: Session
  user: AppUser
  online: boolean
  focusOnMount: boolean
  onSelect: (id: string) => void
  onActivity: (activity: FormActivity) => void
}

function SessionDetailBody({ session, user, online, focusOnMount, onSelect, onActivity }: BodyProps) {
  const { sessions, commentsBySession, users, serverSkewMs } = useAppData()
  // Solo la sesión en curso necesita refresco por segundos.
  const nowMs = useNow(session.end_time === null ? 1000 : 60_000) + serverSkewMs
  const minuteMs = Math.floor(nowMs / 60_000) * 60_000
  const [editingNote, setEditingNote] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const topRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (focusOnMount) topRef.current?.focus()
  }, [focusOnMount])

  const flags = useMemo(() => computeFlags(sessions, minuteMs).get(session.id), [sessions, minuteMs, session.id])
  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const comments = commentsBySession.get(session.id) ?? []

  const status = sessionStatus(session)
  const open = status === 'en_curso'
  const voided = status === 'anulada'
  const dur = open ? Math.max(0, nowMs - session.start_time.toMillis()) : durationMs(session)
  const isOwnerStudent = user.role === 'student' && session.owner === user.uid
  const isSupervisor = user.role === 'supervisor'
  const canEditNote = isOwnerStudent && !voided && !open
  const canVoid = isOwnerStudent && !voided && !open

  const overlaps = (flags?.overlapsWith ?? []).map((id) => sessionsById.get(id)).filter((s): s is Session => !!s)
  const hasMarks = overlaps.length > 0 || !!flags?.dayOverLimit || flags?.lateDays != null || (flags?.editCount ?? 0) > 0

  const authorName = (uid: string) => users.find((u) => u.uid === uid)?.name ?? 'Supervisora'

  return (
    <div className="detail" ref={topRef} tabIndex={-1}>
      <div className="detail-summary">
        <p className={voided ? 'detail-duration is-voided' : 'detail-duration'}>{formatDuration(dur)}</p>
        <p className="detail-schedule">{scheduleLabel(session)}</p>
        <div className="tags">
          <span className={voided ? 'tag tag-danger' : open ? 'tag tag-brand' : 'tag'}>
            {statusLabel(status).toLocaleLowerCase('es-ES')}
          </span>
          <span className={session.method === 'live' ? 'tag' : 'tag tag-info'}>
            {session.method === 'live' ? 'en vivo' : 'manual'}
          </span>
          {session.adjusted && <span className="tag tag-warn">fin ajustado</span>}
        </div>
      </div>

      {voided && (
        <Notice kind="error" title="Sesión anulada: no cuenta en el total">
          <p className="pre-wrap">
            <strong>Motivo:</strong> {session.void_reason || '—'}
          </p>
        </Notice>
      )}
      {session.adjusted && (
        <Notice kind="warn" title="Fin ajustado a mano">
          <p className="pre-wrap">
            <strong>Motivo:</strong> {session.adjust_reason || '—'}
          </p>
        </Notice>
      )}

      <section className="detail-section" aria-labelledby="detail-data">
        <h3 id="detail-data" className="detail-heading">
          Datos
        </h3>
        <dl className="detail-grid">
          <div>
            <dt>Inicio{session.method === 'manual' ? ' (aprox.)' : ''}</dt>
            <dd>{formatDateTime(session.start_time)}</dd>
          </div>
          <div>
            <dt>Fin{session.method === 'manual' ? ' (aprox.)' : ''}</dt>
            <dd>{session.end_time ? formatDateTime(session.end_time) : 'En curso'}</dd>
          </div>
          <div>
            <dt>Duración</dt>
            <dd className="tabular">
              {formatDuration(dur)}
              {open
                ? dur > MAX_SESSION_MS
                  ? ` (supera las ${MAX_SESSION_HOURS} h: falta indicar la hora de fin)`
                  : ' (provisional)'
                : ''}
            </dd>
          </div>
          <div>
            <dt>Método</dt>
            <dd>{methodLabel(session.method)}</dd>
          </div>
          <div>
            <dt>Registrada</dt>
            <dd>{formatDateTime(session.created_at)}</dd>
          </div>
          <div>
            <dt>Última modificación</dt>
            <dd>{session.rev > 0 ? formatDateTime(session.updated_at) : '—'}</dd>
          </div>
          <div>
            <dt>Cambios</dt>
            <dd>{session.rev}</dd>
          </div>
          <div>
            <dt>Identificador</dt>
            <dd className="detail-id">{session.id}</dd>
          </div>
        </dl>
      </section>

      {hasMarks && (
        <section className="detail-section" aria-labelledby="detail-marks">
          <h3 id="detail-marks" className="detail-heading">
            Marcas
          </h3>
          <ul className="marks">
            {overlaps.length > 0 && (
              <li>
                <span>Se solapa con {overlaps.length === 1 ? 'otra sesión' : `${overlaps.length} sesiones`}:</span>
                <span className="mark-links">
                  {overlaps.map((o) => (
                    <button key={o.id} type="button" className="btn btn-secondary" onClick={() => onSelect(o.id)}>
                      {formatDate(o.start_time)} · {scheduleLabel(o)}
                    </button>
                  ))}
                </span>
              </li>
            )}
            {flags?.dayOverLimit && (
              <li>Ese día suma más de {DAY_WARN_HOURS} h entre todas las sesiones válidas.</li>
            )}
            {flags?.lateDays != null && (
              <li>
                Registrada {plural(Math.floor(flags.lateDays), 'día', 'días')} después de terminar (el aviso salta a
                partir de {LATE_FLAG_HOURS} h).
              </li>
            )}
            {(flags?.editCount ?? 0) > 0 && (
              <li>Nota editada {plural(flags?.editCount ?? 0, 'vez', 'veces')}: consulta el historial de cambios.</li>
            )}
          </ul>
        </section>
      )}

      <section className="detail-section" aria-labelledby="detail-note">
        <div className="detail-heading-row">
          <h3 id="detail-note" className="detail-heading">
            Nota
          </h3>
          {canEditNote && !editingNote && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setEditingNote(true)}
              disabled={!online}
            >
              <IconPencil size={18} />
              Editar nota
            </button>
          )}
        </div>
        {editingNote ? (
          <NoteEditor
            session={session}
            online={online}
            onDone={() => setEditingNote(false)}
            onActivity={onActivity}
          />
        ) : session.note ? (
          <p className="detail-note pre-wrap">{session.note}</p>
        ) : (
          <p className="muted">Sin nota.</p>
        )}
        {isOwnerStudent && open && (
          <p className="muted small">
            La nota de la sesión en curso se escribe en la tarjeta de fichaje y se guarda al parar o con «Guardar nota».
          </p>
        )}
      </section>

      <section className="detail-section" aria-labelledby="detail-comments">
        <h3 id="detail-comments" className="detail-heading">
          <IconMessage size={18} />
          {isSupervisor ? 'Comentarios' : 'Comentarios de tu profesora'}
          {comments.length > 0 && <span className="detail-count">{comments.length}</span>}
        </h3>
        {comments.length === 0 ? (
          <p className="muted">
            {isSupervisor ? 'Todavía no has comentado esta sesión.' : 'Tu profesora no ha comentado esta sesión.'}
          </p>
        ) : (
          <ol className="comment-list">
            {comments.map((c) => (
              <CommentItem key={c.id} comment={c} author={authorName(c.author_uid)} />
            ))}
          </ol>
        )}
        {isSupervisor && <CommentForm author={user} session={session} online={online} onActivity={onActivity} />}
      </section>

      <section className="detail-section" aria-labelledby="detail-history">
        <h3 id="detail-history" className="detail-heading">
          <IconHistory size={18} />
          Historial de cambios
        </h3>
        <RevisionHistory session={session} />
      </section>

      {isOwnerStudent && (
        <section className="detail-section detail-danger" aria-labelledby="detail-actions">
          <h3 id="detail-actions" className="detail-heading">
            Anular
          </h3>
          {canVoid ? (
            <>
              <p className="muted small">
                Las horas de una sesión cerrada no se pueden cambiar. Si son incorrectas, anúlala (no cuenta en el total)
                y añade una entrada manual con las horas buenas.
              </p>
              <div>
                <button
                  type="button"
                  className="btn btn-danger-outline"
                  onClick={() => setVoidOpen(true)}
                  disabled={!online}
                >
                  <IconBan size={18} />
                  Anular sesión…
                </button>
              </div>
            </>
          ) : (
            <p className="muted small">
              {voided
                ? 'Esta sesión ya está anulada y no admite más cambios.'
                : 'Solo se pueden anular sesiones terminadas. Para cerrarla, usa la tarjeta de fichaje.'}
            </p>
          )}
        </section>
      )}

      {voidOpen && <VoidDialog session={session} online={online} onClose={() => setVoidOpen(false)} />}
    </div>
  )
}

function CommentItem({ comment, author }: { comment: Comment; author: string }) {
  // Un comentario recién enviado puede llegar con la hora del servidor aún pendiente.
  const at = comment.created_at as Timestamp | null
  return (
    <li className="comment">
      <p className="comment-meta">
        <strong>{author}</strong>
        <span className="muted">{at ? formatDateTime(at) : 'enviando…'}</span>
      </p>
      <p className="pre-wrap">{comment.text}</p>
    </li>
  )
}
