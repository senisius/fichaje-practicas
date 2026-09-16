import { useEffect, useRef, useState, type FormEvent } from 'react'
import { editSessionNote, friendlyError } from '../data/api'
import { MAX_NOTE, MIN_MANUAL_NOTE } from '../lib/limits'
import { validateNote } from '../lib/validation'
import type { Session } from '../types'
import { TextAreaField } from './Field'
import { Notice } from './Notice'
import { useToast } from './toast-context'
import { useFormActivity, type FormActivity } from './form-activity'

interface Props {
  session: Session
  online: boolean
  onDone: () => void
  /** Avisa al panel de si hay texto sin guardar o un guardado pendiente (para no cerrarlo sin querer). */
  onActivity?: (activity: FormActivity) => void
}

/** Edición en línea de la nota (deja revisión y la supervisora lo ve como "nota editada"). */
export function NoteEditor({ session, online, onDone, onActivity }: Props) {
  const toast = useToast()
  const [value, setValue] = useState(session.note)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [])

  const trimmed = value.trim()
  const changed = trimmed !== session.note
  const errors = validateNote(trimmed, session.method).errors
  const mounted = useFormActivity({ dirty: changed, busy: pending }, onActivity)

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!changed || errors.length > 0 || pending || !online) return
    setPending(true)
    setError(null)
    try {
      await editSessionNote(session.id, trimmed)
      toast.show('Nota guardada.', 'success')
      onDone()
    } catch (err) {
      const message = friendlyError(err)
      // Si el panel ya no está abierto, el error no se vería: se avisa con un toast
      if (!mounted.current) toast.show(`No se ha guardado la nota: ${message}`, 'error')
      else {
        setError(message)
        setPending(false)
      }
    }
  }

  return (
    <form
      className="form note-editor"
      onSubmit={handleSubmit}
      onKeyDown={(e) => {
        // Escape cancela solo la edición, no cierra el panel entero
        if (e.key !== 'Escape') return
        e.stopPropagation()
        e.preventDefault()
        if (!pending) onDone()
      }}
      noValidate
    >
      <TextAreaField
        ref={ref}
        label="Nueva nota"
        hint={
          session.method === 'manual'
            ? `Obligatoria en las entradas manuales (mínimo ${MIN_MANUAL_NOTE} caracteres). El cambio quedará en el historial.`
            : 'El cambio quedará en el historial de la sesión.'
        }
        rows={4}
        maxCount={MAX_NOTE}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          setError(null)
          // En el mismo evento (sin esperar al efecto): un cierre inmediato ya pide confirmación
          onActivity?.({ dirty: e.target.value.trim() !== session.note, busy: pending })
        }}
        disabled={pending}
        error={changed ? (errors[0] ?? null) : null}
      />
      <div aria-live="polite">
        {error && (
          <Notice kind="error" title="No se ha guardado la nota">
            <p>{error}</p>
          </Notice>
        )}
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <button type="button" className="btn btn-secondary" onClick={onDone} disabled={pending}>
          Cancelar
        </button>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={pending || !online || !changed || errors.length > 0}
        >
          {pending ? 'Guardando…' : 'Guardar nota'}
        </button>
      </div>
    </form>
  )
}
