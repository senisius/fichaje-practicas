import { useRef, useState, type FormEvent } from 'react'
import { addComment, friendlyError } from '../data/api'
import { MAX_COMMENT } from '../lib/limits'
import { validateComment } from '../lib/validation'
import type { AppUser, Session } from '../types'
import { TextAreaField } from './Field'
import { useFormActivity, type FormActivity } from './form-activity'
import { IconMessage } from './icons'
import { Notice } from './Notice'
import { useToast } from './toast-context'

interface Props {
  author: AppUser
  session: Session
  online: boolean
  /** Avisa al panel de si hay texto sin enviar o un envío pendiente (para no cerrarlo sin querer). */
  onActivity?: (activity: FormActivity) => void
}

/** Caja para que la supervisora comente una sesión (lo único que puede escribir). */
export function CommentForm({ author, session, online, onActivity }: Props) {
  const toast = useToast()
  const [text, setText] = useState('')
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)

  const trimmed = text.trim()
  const errors = validateComment(trimmed).errors
  const mounted = useFormActivity({ dirty: trimmed.length > 0, busy: pending }, onActivity)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAttempted(true)
    if (errors.length > 0 || pending || !online) return
    setPending(true)
    setError(null)
    try {
      await addComment(author, session, trimmed)
      toast.show('Comentario enviado.', 'success')
      if (!mounted.current) return
      setText('')
      setAttempted(false)
      setPending(false)
      // El botón se desactivó mientras se enviaba: el foco vuelve a la caja para seguir escribiendo
      requestAnimationFrame(() => textRef.current?.focus())
    } catch (err) {
      const message = friendlyError(err)
      // Si el panel ya no está abierto, el error no se vería: se avisa con un toast
      if (!mounted.current) {
        toast.show(`No se ha enviado el comentario: ${message}`, 'error')
        return
      }
      setError(message)
      setPending(false)
    }
  }

  return (
    <form className="form comment-form" onSubmit={handleSubmit} noValidate>
      <TextAreaField
        ref={textRef}
        label="Añadir un comentario"
        hint="Los comentarios no se pueden editar ni borrar; para corregir uno, añade otro."
        rows={3}
        maxCount={MAX_COMMENT}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setError(null)
          // En el mismo evento (sin esperar al efecto): un Escape inmediato ya pide confirmación
          onActivity?.({ dirty: e.target.value.trim().length > 0, busy: pending })
        }}
        disabled={pending}
        error={attempted || trimmed.length > 0 ? (errors[0] ?? null) : null}
      />
      <div aria-live="polite">
        {error && (
          <Notice kind="error" title="No se ha enviado el comentario">
            <p>{error}</p>
          </Notice>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="submit" className="btn btn-primary" disabled={pending || !online || trimmed.length === 0}>
          <IconMessage size={18} />
          {pending ? 'Enviando…' : 'Enviar comentario'}
        </button>
      </div>
      {!online && <p className="muted small">Sin conexión: no se pueden enviar comentarios ahora.</p>}
    </form>
  )
}
