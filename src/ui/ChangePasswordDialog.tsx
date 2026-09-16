import { useId, useRef, useState, type FormEvent } from 'react'
import { changePassword, friendlyError } from '../data/api'
import { PasswordField } from './Field'
import { Modal } from './Modal'
import { Notice } from './Notice'
import { MIN_PASSWORD } from './text'
import { useToast } from './toast-context'

export function ChangePasswordDialog({ online, onClose }: { online: boolean; onClose: () => void }) {
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const firstRef = useRef<HTMLInputElement>(null)

  const currentError = current ? null : 'Escribe tu contraseña actual.'
  const nextError =
    next.length < MIN_PASSWORD
      ? `La contraseña nueva debe tener al menos ${MIN_PASSWORD} caracteres.`
      : next === current
        ? 'La contraseña nueva debe ser distinta de la actual.'
        : null
  const repeatError = repeat !== next ? 'Las dos contraseñas nuevas no coinciden.' : null
  const valid = !currentError && !nextError && !repeatError

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAttempted(true)
    if (!valid || pending || !online) return
    setPending(true)
    setError(null)
    try {
      await changePassword(current, next)
      toast.show('Contraseña cambiada.', 'success')
      onClose()
    } catch (err) {
      setError(friendlyError(err))
      setPending(false)
    }
  }

  const formId = useId()

  return (
    <Modal
      title="Cambiar contraseña"
      description="Solo cambia la contraseña de esta herramienta."
      onClose={onClose}
      busy={pending}
      dismissOnBackdrop={false}
      initialFocus={firstRef}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending || !online}>
            {pending ? 'Guardando…' : 'Cambiar contraseña'}
          </button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <PasswordField
          ref={firstRef}
          label="Contraseña actual"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          disabled={pending}
          error={attempted ? currentError : null}
        />
        <PasswordField
          label="Contraseña nueva"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          disabled={pending}
          hint={`Al menos ${MIN_PASSWORD} caracteres. No reutilices la contraseña de la UAB.`}
          error={attempted || next.length > 0 ? nextError : null}
        />
        <PasswordField
          label="Repite la contraseña nueva"
          autoComplete="new-password"
          value={repeat}
          onChange={(e) => setRepeat(e.target.value)}
          disabled={pending}
          error={attempted || repeat.length > 0 ? repeatError : null}
        />
        <div aria-live="polite">
          {error && (
            <Notice kind="error" title="No se ha cambiado la contraseña">
              <p>{error}</p>
            </Notice>
          )}
          {!online && <Notice kind="warn">Necesitas conexión para cambiar la contraseña.</Notice>}
        </div>
      </form>
    </Modal>
  )
}
