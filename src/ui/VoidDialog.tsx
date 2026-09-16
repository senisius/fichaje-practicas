import { useId, useRef, useState, type FormEvent } from 'react'
import { friendlyError, voidSession } from '../data/api'
import { MAX_REASON, MIN_REASON } from '../lib/limits'
import { durationMs, formatDate, formatDuration } from '../lib/time'
import { validateVoidReason } from '../lib/validation'
import type { Session } from '../types'
import { TextAreaField } from './Field'
import { IconBan } from './icons'
import { Modal } from './Modal'
import { LiveMessage, Notice } from './Notice'
import { scheduleLabel } from './session-labels'
import { useSubmitAnnouncer } from './submit-announcer'
import { useToast } from './toast-context'

interface Props {
  session: Session
  online: boolean
  onClose: () => void
}

/** Anulación irreversible con motivo y confirmación explícita. */
export function VoidDialog({ session, online, onClose }: Props) {
  const toast = useToast()
  const formId = useId()
  const reasonRef = useRef<HTMLTextAreaElement>(null)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const announcer = useSubmitAnnouncer()

  const trimmed = reason.trim()
  const errors = validateVoidReason(trimmed).errors
  const showErrors = attempted || trimmed.length > 0

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAttempted(true)
    if (errors.length > 0 || !confirmed) {
      announcer.announce(
        `No se puede anular todavía: ${[...errors, ...(confirmed ? [] : ['Marca la casilla de confirmación.'])].join(' ')}`,
      )
      return
    }
    if (pending || !online) return
    setPending(true)
    setError(null)
    try {
      await voidSession(session.id, trimmed)
      toast.show('Sesión anulada.', 'success')
      onClose()
    } catch (err) {
      const message = friendlyError(err)
      setError(message)
      announcer.announce(`No se ha anulado la sesión: ${message}`)
      setPending(false)
    }
  }

  return (
    <Modal
      role="alertdialog"
      title="Anular sesión"
      description={`${formatDate(session.start_time)}, ${scheduleLabel(session)} · ${formatDuration(durationMs(session))}`}
      onClose={onClose}
      busy={pending}
      dismissOnBackdrop={false}
      initialFocus={reasonRef}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button
            type="submit"
            form={formId}
            className="btn btn-danger"
            disabled={pending || !online || !confirmed || errors.length > 0}
          >
            <IconBan size={18} />
            {pending ? 'Anulando…' : 'Anular definitivamente'}
          </button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <Notice kind="warn" title="Esta acción no se puede deshacer">
          <p>
            La sesión dejará de contar en el total y aparecerá tachada, con el motivo, para tu profesora. Si las horas
            estaban mal, anúlala y añade después una entrada manual con las horas correctas.
          </p>
        </Notice>
        <TextAreaField
          ref={reasonRef}
          label="Motivo de la anulación"
          hint={`Entre ${MIN_REASON} y ${MAX_REASON} caracteres.`}
          rows={3}
          maxCount={MAX_REASON}
          required
          value={reason}
          onChange={(e) => {
            setReason(e.target.value)
            setError(null)
          }}
          disabled={pending}
          error={showErrors ? (errors[0] ?? null) : null}
        />
        <label className="checkbox">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            disabled={pending}
          />
          <span>Entiendo que la anulación es definitiva y no se puede deshacer.</span>
        </label>
        <div className="stack">
          {error && (
            <Notice kind="error" title="No se ha anulado la sesión">
              <p>{error}</p>
            </Notice>
          )}
          {!online && <Notice kind="warn">Sin conexión: no se puede anular ahora.</Notice>}
        </div>
        <LiveMessage announcement={announcer.announcement} />
      </form>
    </Modal>
  )
}
