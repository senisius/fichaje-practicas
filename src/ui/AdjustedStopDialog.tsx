import { useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { friendlyError } from '../data/api'
import { useNow } from '../data/AppDataProvider'
import { MAX_REASON, MAX_SESSION_HOURS, MIN_REASON } from '../lib/limits'
import {
  formatDateTime,
  formatDuration,
  formatTimeSeconds,
  madridDateKey,
  madridTimeKind,
  madridToUtcOptions,
} from '../lib/time'
import { validateAdjustedStop } from '../lib/validation'
import type { Session } from '../types'
import { TextAreaField, TextField } from './Field'
import { Modal } from './Modal'
import { LiveMessage, MessageList, Notice } from './Notice'
import { useSubmitAnnouncer } from './submit-announcer'
import { useToast } from './toast-context'

interface Props {
  session: Session
  serverSkewMs: number
  online: boolean
  /** Cierra la sesión con la hora y el motivo indicados (la nota es la de la tarjeta de fichaje). */
  onSubmit: (fix: { end: Date; reason: string }) => Promise<void>
  onClose: () => void
}

type Field = 'date' | 'time' | 'reason'

const isReasonError = (e: string): boolean => e.startsWith('El motivo')

/** Cierre ajustado: la hora real de fin la teclea el estudiante (hora de Madrid) con un motivo. */
export function AdjustedStopDialog({ session, serverSkewMs, online, onSubmit, onClose }: Props) {
  const toast = useToast()
  const formId = useId()
  const timeRef = useRef<HTMLInputElement>(null)
  const nowMs = useNow(15_000) + serverSkewMs
  const startDate = session.start_time.toDate()
  const startKey = madridDateKey(session.start_time)
  const todayKey = madridDateKey(nowMs)
  const announcer = useSubmitAnnouncer()

  const [date, setDate] = useState(startKey)
  const [time, setTime] = useState('')
  // En la hora repetida de octubre: 0 = la primera (verano), 1 = la segunda (invierno)
  const [occurrence, setOccurrence] = useState(0)
  const [reason, setReason] = useState('')
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set())
  const [attempted, setAttempted] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = useMemo(() => {
    if (!date || !time) return []
    try {
      return madridToUtcOptions(date, time)
    } catch {
      return []
    }
  }, [date, time])
  const repeated = options.length > 1 && madridTimeKind(date, time) === 'repetida'
  const end = options.length > 0 ? (options[Math.min(occurrence, options.length - 1)] ?? null) : null

  const result = end ? validateAdjustedStop({ end, reason, wall: { date, time } }, { nowMs, start: startDate }) : null
  const errors = end ? (result?.errors ?? []) : ['Indica la fecha y la hora a la que terminaste.']
  const warnings = result?.warnings ?? []
  const valid = errors.length === 0 && end !== null
  const endErrors = errors.filter((e) => !isReasonError(e))
  const reasonError = errors.find(isReasonError) ?? null
  const show = (...fields: Field[]) => attempted || fields.some((f) => touched.has(f))

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAttempted(true)
    if (!valid || !end || pending || !online) {
      if (!valid) announcer.announce(`No se puede cerrar la sesión: ${errors.join(' ')}`)
      return
    }
    setPending(true)
    setError(null)
    try {
      await onSubmit({ end, reason: reason.trim() })
      toast.show('Sesión cerrada con la hora indicada.', 'success')
      onClose()
    } catch (err) {
      const message = friendlyError(err)
      setError(message)
      announcer.announce(`No se ha podido cerrar la sesión: ${message}`)
      setPending(false)
    }
  }

  const change = (field: Field, setter: (v: string) => void) => (v: string) => {
    setter(v)
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))
    setError(null)
  }

  // Madrid siempre tiene desfases de horas enteras: los segundos del inicio son los del instante UTC
  const startHasSeconds = startDate.getTime() % 60_000 !== 0

  return (
    <Modal
      title="¿A qué hora terminaste?"
      description={`Sesión iniciada el ${formatDateTime(session.start_time)}.`}
      onClose={onClose}
      busy={pending}
      dismissOnBackdrop={false}
      initialFocus={timeRef}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
            Cancelar
          </button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={pending || !online}>
            {pending ? 'Guardando…' : 'Cerrar sesión con esta hora'}
          </button>
        </>
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <p className="muted small">
          Indica la hora real de fin en hora de Madrid. La sesión quedará marcada como «fin ajustado» y tu profesora verá
          el motivo. Como máximo {MAX_SESSION_HOURS} h desde el inicio.
        </p>
        <div className="field-grid">
          <TextField
            label="Fecha de fin"
            type="date"
            required
            min={startKey}
            max={todayKey}
            value={date}
            onChange={(e) => change('date', setDate)(e.target.value)}
            disabled={pending}
          />
          <TextField
            ref={timeRef}
            label="Hora de fin"
            type="time"
            required
            value={time}
            onChange={(e) => change('time', setTime)(e.target.value)}
            disabled={pending}
            error={show('date', 'time') ? (endErrors[0] ?? null) : null}
          />
        </div>

        {repeated && (
          <fieldset className="fieldset">
            <legend className="field-label">Las {time} se repiten ese día por el cambio de hora. ¿Cuáles?</legend>
            {options.map((o, i) => (
              <label key={o.getTime()} className="checkbox">
                <input
                  type="radio"
                  name={`${formId}-occurrence`}
                  checked={occurrence === i}
                  onChange={() => setOccurrence(i)}
                  disabled={pending}
                />
                <span>
                  {i === 0 ? 'La primera (horario de verano)' : 'La segunda (horario de invierno)'}: duración{' '}
                  {formatDuration(o.getTime() - startDate.getTime())}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <TextAreaField
          label="Motivo"
          hint={`Por qué no paraste a tiempo (${MIN_REASON}–${MAX_REASON} caracteres).`}
          rows={3}
          maxCount={MAX_REASON}
          required
          value={reason}
          onChange={(e) => change('reason', setReason)(e.target.value)}
          disabled={pending}
          error={show('reason') ? reasonError : null}
        />

        {end && valid && (
          <Notice kind="info">
            <p>
              Fin: <strong>{formatDateTime(end)}</strong> · duración resultante{' '}
              <strong className="tabular">{formatDuration(end.getTime() - startDate.getTime())}</strong>
              {startHasSeconds && (
                <> (se cuentan los segundos: la sesión empezó a las {formatTimeSeconds(startDate)})</>
              )}
            </p>
          </Notice>
        )}

        <div className="stack">
          {attempted && errors.length > 0 && (
            <Notice kind="error" title="Revisa estos datos">
              <MessageList items={errors} />
            </Notice>
          )}
          {warnings.length > 0 && (
            <Notice kind="warn">
              <MessageList items={warnings} />
            </Notice>
          )}
          {error && (
            <Notice kind="error" title="No se ha podido cerrar la sesión">
              <p>{error}</p>
            </Notice>
          )}
          {!online && <Notice kind="warn">Sin conexión: no se puede cerrar la sesión ahora.</Notice>}
        </div>
        <LiveMessage announcement={announcer.announcement} />
      </form>
    </Modal>
  )
}
