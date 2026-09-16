import { useEffect, useMemo, useRef, useState } from 'react'
import { editSessionNote, friendlyError, startSession, stopSession } from '../data/api'
import { useAppData, useNow } from '../data/AppDataProvider'
import { clearNoteDraft, listNoteDrafts, loadNoteDraft, saveNoteDraft } from '../data/note-draft'
import { MAX_BACKDATE_DAYS, MAX_NOTE, MAX_SESSION_HOURS, WARN_OPEN_HOURS } from '../lib/limits'
import { formatClock, formatDate, formatTime, HOUR_MS, madridDateKey } from '../lib/time'
import { cleanText, validateNote } from '../lib/validation'
import type { AppUser, Session } from '../types'
import { AdjustedStopDialog } from './AdjustedStopDialog'
import { TextAreaField } from './Field'
import { IconClock, IconPlay, IconPlus, IconStop } from './icons'
import { ManualEntryDialog } from './ManualEntryDialog'
import { Notice, Skeleton } from './Notice'
import { scheduleLabel } from './session-labels'
import { useToast } from './toast-context'
import './cards.css'

interface Props {
  user: AppUser
  openSession: Session | null
  serverSkewMs: number
  online: boolean
  loading: boolean
  /** No se ha podido comprobar la sesión en curso (ha fallado una suscripción): no se puede fichar. */
  unavailable?: boolean
}

interface NoteDraft {
  sessionId: string | null
  /** Nota del servidor cuando se inició el borrador. */
  base: string
  value: string
}

/**
 * Tras EMPEZAR o PARAR aparece el botón contrario en el mismo sitio: el segundo clic de un doble clic
 * (hasta ~500 ms) no debe pulsarlo. Solo cuenta para el botón principal, no para el cierre desde el diálogo.
 */
const DOUBLE_CLICK_GUARD_MS = 700

/** Borrador inicial: el guardado en este dispositivo (si lo hay) o la nota del servidor. */
function initialDraft(sessionId: string | null, remoteNote: string): NoteDraft {
  const stored = sessionId ? loadNoteDraft(sessionId) : null
  return { sessionId, base: remoteNote, value: stored ?? remoteNote }
}

/** Tarjeta principal del student: EMPEZAR / PARAR, cronómetro y nota de la sesión en curso. */
export function ClockCard({ user, openSession, serverSkewMs, online, loading, unavailable = false }: Props) {
  const toast = useToast()
  const { sessions } = useAppData()
  const nowMs = useNow(1000) + serverSkewMs
  const [pending, setPending] = useState<'start' | 'stop' | 'note' | null>(null)
  // Tras escribir, esperamos a que la suscripción refleje el cambio para no mostrar un estado viejo.
  const [expectOpen, setExpectOpen] = useState<boolean | null>(null)
  // Nota guardada con «Guardar nota» que aún no ha llegado del servidor.
  const [expectNote, setExpectNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<'adjust' | 'manual' | null>(null)
  const [draftsVersion, setDraftsVersion] = useState(0)
  const actionRef = useRef<HTMLButtonElement>(null)
  const refocusAction = useRef(false)
  const lastActionAt = useRef(0)

  const sessionId = openSession?.id ?? null
  const remoteNote = openSession?.note ?? ''
  const [draft, setDraft] = useState<NoteDraft>(() => initialDraft(sessionId, remoteNote))
  // Última sesión abierta vista, última parada desde este dispositivo y paradas desde otro dispositivo
  // con el cierre ajustado abierto (cada una muestra un aviso).
  const [lastOpenId, setLastOpenId] = useState(sessionId)
  const [localStopId, setLocalStopId] = useState<string | null>(null)
  const [remoteStops, setRemoteStops] = useState(0)

  // Ajustes de estado durante el render (patrón recomendado por React en vez de un efecto).
  if (draft.sessionId !== sessionId) {
    setDraft(initialDraft(sessionId, remoteNote))
  } else if (draft.base !== remoteNote) {
    // La nota cambió en el servidor: se adopta si no había cambios locales.
    setDraft({ sessionId, base: remoteNote, value: draft.value === draft.base ? remoteNote : draft.value })
  }
  if (expectOpen !== null && (openSession !== null) === expectOpen) {
    setExpectOpen(null)
  }
  if (expectNote !== null && (remoteNote === expectNote || openSession === null)) {
    setExpectNote(null)
  }
  if (sessionId !== null && sessionId !== lastOpenId) {
    setLastOpenId(sessionId)
  }
  // La sesión se ha parado con el cierre ajustado abierto: si no fue desde aquí, se cierra y se avisa
  if (dialog === 'adjust' && openSession === null && !loading) {
    setDialog(null)
    if (localStopId !== lastOpenId && !unavailable) setRemoteStops((n) => n + 1)
  }

  useEffect(() => {
    if (expectOpen === null) return
    const t = window.setTimeout(() => setExpectOpen(null), 10_000)
    return () => window.clearTimeout(t)
  }, [expectOpen])

  useEffect(() => {
    if (expectNote === null) return
    const t = window.setTimeout(() => setExpectNote(null), 10_000)
    return () => window.clearTimeout(t)
  }, [expectNote])

  const busy = pending !== null || expectOpen !== null

  // El botón principal se desactiva mientras se ficha y el navegador saca el foco a <body>:
  // si se pulsó con el teclado, el foco vuelve al botón nuevo (EMPEZAR o PARAR).
  useEffect(() => {
    if (busy || !refocusAction.current) return
    refocusAction.current = false
    actionRef.current?.focus()
  }, [busy])

  useEffect(() => {
    if (remoteStops > 0) toast.show('La sesión se ha parado desde otro dispositivo.', 'info')
  }, [remoteStops, toast])

  // Borradores de sesiones ya cerradas: si la nota del servidor coincide, sobran; si no, se ofrecen
  // para no perder el texto (p. ej. la sesión se paró desde otro dispositivo).
  const sessionsById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions])
  const lostDrafts = useMemo(() => {
    // draftsVersion cambia al descartar un borrador: obliga a volver a leer el almacenamiento
    void draftsVersion
    if (loading || unavailable) return []
    return listNoteDrafts().filter((d) => {
      const s = d.sessionId === sessionId ? undefined : sessionsById.get(d.sessionId)
      return s !== undefined && s.end_time !== null && cleanText(d.text) !== '' && cleanText(d.text) !== s.note
    })
  }, [loading, unavailable, sessionId, sessionsById, draftsVersion])

  useEffect(() => {
    if (loading || unavailable) return
    for (const d of listNoteDrafts()) {
      const s = d.sessionId === sessionId ? undefined : sessionsById.get(d.sessionId)
      if (s && s.end_time !== null && (cleanText(d.text) === '' || cleanText(d.text) === s.note)) {
        clearNoteDraft(d.sessionId)
      }
    }
  }, [loading, unavailable, sessionId, sessionsById])

  const elapsed = openSession ? Math.max(0, nowMs - openSession.start_time.toMillis()) : 0
  const overWarn = elapsed >= WARN_OPEN_HOURS * HOUR_MS
  const overMax = elapsed > MAX_SESSION_HOURS * HOUR_MS
  const noteErrors = openSession ? validateNote(draft.value, 'live').errors : []
  const noteChanged = openSession !== null && cleanText(draft.value) !== remoteNote
  const tooSoon = () => Date.now() - lastActionAt.current < DOUBLE_CLICK_GUARD_MS

  const handleStart = async () => {
    if (busy || !online || unavailable || tooSoon()) return
    refocusAction.current = document.activeElement === actionRef.current
    setPending('start')
    setError(null)
    try {
      await startSession(user.uid)
      lastActionAt.current = Date.now()
      setExpectOpen(true)
      toast.show('Sesión iniciada.', 'success')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setPending(null)
    }
  }

  /** Para la sesión en curso (normal o con fin ajustado) con la nota del borrador. */
  const runStop = async (fix?: { end: Date; reason: string }) => {
    if (!openSession) throw new Error('No hay ninguna sesión en curso.')
    const id = openSession.id
    setLocalStopId(id)
    try {
      await stopSession(user.uid, draft.value, fix)
    } catch (e) {
      setLocalStopId(null)
      throw e
    }
    clearNoteDraft(id)
    setExpectOpen(false)
  }

  const handleStop = async () => {
    if (busy || !online || unavailable || !openSession || noteErrors.length > 0 || tooSoon()) return
    refocusAction.current = document.activeElement === actionRef.current
    setPending('stop')
    setError(null)
    try {
      await runStop()
      lastActionAt.current = Date.now()
      toast.show('Sesión terminada.', 'success')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setPending(null)
    }
  }

  // Guardado explícito: deja revisión (la supervisora lo ve como "nota editada"), por eso no es automático.
  const handleSaveNote = async () => {
    if (busy || !online || unavailable || !openSession || !noteChanged || noteErrors.length > 0 || expectNote !== null) {
      return
    }
    const id = openSession.id
    const text = cleanText(draft.value)
    setPending('note')
    setError(null)
    try {
      await editSessionNote(id, text)
      clearNoteDraft(id)
      setExpectNote(text)
      toast.show('Nota guardada.', 'success')
    } catch (e) {
      setError(friendlyError(e))
    } finally {
      setPending(null)
    }
  }

  const changeNote = (value: string) => {
    setDraft({ ...draft, value })
    if (sessionId === null) return
    if (value === remoteNote) clearNoteDraft(sessionId)
    else saveNoteDraft(sessionId, value)
  }

  const discardLost = (id: string) => {
    clearNoteDraft(id)
    setDraftsVersion((v) => v + 1)
  }

  if (loading) {
    return (
      <section className="card clock-card" aria-busy="true" aria-label="Fichaje">
        <Skeleton width="45%" height={16} />
        <Skeleton width="70%" height={52} className="clock-skeleton" />
        <Skeleton height={64} />
      </section>
    )
  }

  const startedToday = openSession ? madridDateKey(openSession.start_time) === madridDateKey(nowMs) : true
  const startLabel = openSession
    ? startedToday
      ? `desde las ${formatTime(openSession.start_time)}`
      : `desde el ${formatDate(openSession.start_time)} a las ${formatTime(openSession.start_time)}`
    : ''
  const cannotClock = busy || !online || unavailable

  return (
    <section className={openSession ? 'card clock-card is-running' : 'card clock-card'} aria-labelledby="clock-title">
      <div className="card-header" style={{ marginBottom: 0 }}>
        <h2 id="clock-title" className="card-title">
          Fichaje
        </h2>
      </div>

      <p className="clock-status" aria-live="polite">
        <span className={openSession ? 'status-dot is-live' : 'status-dot'} aria-hidden="true" />
        {openSession ? <span>En curso {startLabel}</span> : <span>Sin sesión en curso</span>}
      </p>

      <div>
        <p
          className={openSession ? 'clock-time' : 'clock-time is-idle'}
          role="timer"
          aria-label={openSession ? 'Tiempo de la sesión en curso' : 'Cronómetro parado'}
        >
          {formatClock(elapsed)}
        </p>
        {!openSession && <p className="clock-sub">La hora de inicio la pone el servidor, no tu dispositivo.</p>}
      </div>

      {unavailable && (
        <Notice kind="error" title="No se puede fichar ahora">
          <p>No se ha podido comprobar si tienes una sesión en curso. Recarga la página para volver a intentarlo.</p>
        </Notice>
      )}

      {openSession && overWarn && (
        <Notice kind="warn" title={overMax ? `Han pasado más de ${MAX_SESSION_HOURS} h` : `Llevas más de ${WARN_OPEN_HOURS} h`}>
          <p>
            {overMax
              ? 'Ya no se puede parar con la hora actual. Indica a qué hora terminaste de verdad.'
              : '¿Olvidaste parar? Si terminaste antes, usa «Terminé antes / olvidé parar» para poner la hora real.'}
          </p>
        </Notice>
      )}

      {openSession && (
        <div className="clock-note">
          <TextAreaField
            label="Nota de la sesión"
            optional
            hint="Se guarda al parar; hasta entonces solo está en este dispositivo. «Guardar nota» la guarda ya (queda en el historial de cambios)."
            rows={3}
            maxCount={MAX_NOTE}
            value={draft.value}
            onChange={(e) => changeNote(e.target.value)}
            disabled={busy}
            error={noteErrors[0] ?? null}
          />
          <div className="clock-note-actions">
            <p className="muted small" aria-live="polite">
              {noteChanged ? 'Cambios sin guardar en el servidor.' : ''}
            </p>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={handleSaveNote}
              disabled={cannotClock || !noteChanged || noteErrors.length > 0 || expectNote !== null}
            >
              {pending === 'note' ? 'Guardando…' : 'Guardar nota'}
            </button>
          </div>
        </div>
      )}

      <div aria-live="polite">{error && <Notice kind="error">{error}</Notice>}</div>

      {lostDrafts.map((d) => {
        const s = sessionsById.get(d.sessionId)
        return (
          <Notice
            key={d.sessionId}
            kind="warn"
            title="Una nota no llegó a guardarse"
            actions={
              <button type="button" className="btn btn-secondary" onClick={() => discardLost(d.sessionId)}>
                Descartar
              </button>
            }
          >
            <p>
              La sesión{s ? ` del ${formatDate(s.start_time)} (${scheduleLabel(s)})` : ''} se paró sin esta nota, que
              escribiste en este dispositivo:
            </p>
            <p className="pre-wrap lost-note">{d.text}</p>
            <p className="small">Si la quieres conservar, cópiala y añádela desde el historial con «Editar nota».</p>
          </Notice>
        )
      })}

      <div className="clock-actions">
        {!openSession ? (
          <button
            ref={actionRef}
            type="button"
            className="btn btn-primary btn-block btn-clock"
            onClick={handleStart}
            disabled={cannotClock}
          >
            <IconPlay size={22} />
            {pending === 'start' ? 'EMPEZANDO…' : 'EMPEZAR'}
          </button>
        ) : overMax ? (
          <button
            ref={actionRef}
            type="button"
            className="btn btn-primary btn-block btn-clock"
            onClick={() => setDialog('adjust')}
            disabled={cannotClock}
          >
            <IconClock size={22} />
            ¿A qué hora terminaste?
          </button>
        ) : (
          <button
            ref={actionRef}
            type="button"
            className="btn btn-danger btn-block btn-clock"
            onClick={handleStop}
            disabled={cannotClock || noteErrors.length > 0}
          >
            <IconStop size={22} />
            {pending === 'stop' ? 'PARANDO…' : 'PARAR'}
          </button>
        )}
        {openSession && (
          <button type="button" className="btn btn-link" onClick={() => setDialog('adjust')} disabled={cannotClock}>
            Terminé antes / olvidé parar
          </button>
        )}
        {!online && <p className="muted small">Sin conexión: no se puede fichar ahora.</p>}
      </div>

      <div className="clock-extra">
        <button
          type="button"
          className="btn btn-secondary btn-block"
          onClick={() => setDialog('manual')}
          disabled={!online || unavailable}
        >
          <IconPlus size={18} />
          Añadir horas a mano
        </button>
        <p className="muted small">
          Para días en los que no pudiste fichar (hasta {MAX_BACKDATE_DAYS} días atrás).
        </p>
      </div>

      {dialog === 'adjust' && openSession && (
        <AdjustedStopDialog
          session={openSession}
          serverSkewMs={serverSkewMs}
          online={online}
          onSubmit={runStop}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'manual' && <ManualEntryDialog user={user} online={online} onClose={() => setDialog(null)} />}
    </section>
  )
}
