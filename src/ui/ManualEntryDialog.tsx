import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react'
import { addManualSession, friendlyError } from '../data/api'
import { useAppData, useNow } from '../data/AppDataProvider'
import {
  DEFAULT_MANUAL_TIME,
  MAX_BACKDATE_DAYS,
  MAX_NOTE,
  MAX_SESSION_HOURS,
  MIN_MANUAL_NOTE,
} from '../lib/limits'
import { formatDate, formatDuration, formatTime, madridDateKey, madridToUtc, MINUTE_MS } from '../lib/time'
import { validateManual, type ManualInput, type ValidationResult } from '../lib/validation'
import type { AppUser } from '../types'
import { TextAreaField, TextField } from './Field'
import { Modal } from './Modal'
import { LiveMessage, MessageList, Notice } from './Notice'
import { useSubmitAnnouncer } from './submit-announcer'
import { DAY_MS, parseWhole } from './text'
import { useToast } from './toast-context'

interface Props {
  user: AppUser
  online: boolean
  onClose: () => void
}

type Field = 'date' | 'time' | 'hours' | 'minutes' | 'note'

/** Tras pedir confirmación, el botón "Guardar igualmente" aparece donde estaba "Guardar": un doble clic no lo pulsa. */
const CONFIRM_GUARD_MS = 600

/** Separa los errores de validateManual por el campo al que se refieren. */
function splitErrors(errors: string[]) {
  const note = errors.find((e) => e.startsWith('La nota')) ?? null
  const time = errors.find((e) => e.startsWith('La hora')) ?? null
  const duration = errors.find((e) => e.startsWith('Una entrada puede durar')) ?? null
  const date = errors.find((e) => e !== note && e !== time && e !== duration) ?? null
  return { note, time, duration, date }
}

/** Entrada manual: fecha, hora opcional, duración y nota. Errores bloquean; avisos piden confirmación. */
export function ManualEntryDialog({ user, online, onClose }: Props) {
  const { sessions, student, serverSkewMs } = useAppData()
  const toast = useToast()
  const formId = useId()
  const dateRef = useRef<HTMLInputElement>(null)
  const reviewRef = useRef<HTMLButtonElement>(null)
  const confirmSince = useRef(0)
  const nowMs = useNow(30_000) + serverSkewMs
  const announcer = useSubmitAnnouncer()

  const profile = student ?? user
  const programStartMs = profile.program_start?.toMillis() ?? null
  const todayKey = madridDateKey(nowMs)
  const backdateKey = madridDateKey(nowMs - MAX_BACKDATE_DAYS * DAY_MS)
  const programKey = programStartMs !== null ? madridDateKey(programStartMs) : null
  const minKey = programKey && programKey > backdateKey ? programKey : backdateKey

  const [date, setDate] = useState(todayKey)
  const [time, setTime] = useState('')
  const [hours, setHours] = useState('')
  const [minutes, setMinutes] = useState('')
  const [note, setNote] = useState('')
  const [touched, setTouched] = useState<ReadonlySet<Field>>(new Set())
  const [attempted, setAttempted] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Campos de texto (no type="number"): así "8." o "30m" llegan tal cual y dan error en vez de contar 0.
  const h = parseWhole(hours)
  const m = parseWhole(minutes)
  const hoursError =
    Number.isNaN(h) || h > MAX_SESSION_HOURS ? `Las horas deben ser un número entero entre 0 y ${MAX_SESSION_HOURS}.` : null
  const minutesError = Number.isNaN(m) || m > 59 ? 'Los minutos deben ser un número entero entre 0 y 59.' : null
  const badFormat = hoursError !== null || minutesError !== null
  const totalMinutes = badFormat ? 0 : h * 60 + m
  const zeroError = !badFormat && totalMinutes === 0 ? 'Indica la duración (al menos 1 minuto).' : null
  const durationErrors = [hoursError, minutesError, zeroError].filter((e): e is string => e !== null)

  const input: ManualInput = useMemo(
    () => ({ date, time: time || undefined, minutes: totalMinutes, note: note.trim() }),
    [date, time, totalMinutes, note],
  )

  const validation: ValidationResult = useMemo(() => {
    try {
      // Con la duración mal escrita o vacía se valida el resto con 1 minuto para no duplicar mensajes.
      const probe = durationErrors.length > 0 ? { ...input, minutes: 1 } : input
      const programStart = programStartMs !== null ? new Date(programStartMs) : null
      return validateManual(probe, { nowMs, programStart, sessions })
    } catch (e) {
      return { errors: [friendlyError(e)], warnings: [] }
    }
  }, [input, durationErrors.length, nowMs, programStartMs, sessions])

  const errors = [...durationErrors, ...validation.errors]
  const warnings = validation.warnings
  const byField = splitErrors(validation.errors)
  const show = (...fields: Field[]) => attempted || fields.some((f) => touched.has(f))

  const preview = useMemo(() => {
    if (errors.length > 0) return null
    try {
      const start = madridToUtc(date, time || DEFAULT_MANUAL_TIME)
      const end = new Date(start.getTime() + totalMinutes * MINUTE_MS)
      return {
        day: formatDate(start),
        from: formatTime(start),
        to: formatTime(end),
        nextDay: madridDateKey(end) !== madridDateKey(start),
        duration: formatDuration(totalMinutes * MINUTE_MS),
      }
    } catch {
      return null
    }
  }, [errors.length, date, time, totalMinutes])

  // Al pedir confirmación, el foco va a "Revisar": un Enter de más no guarda sin haber leído los avisos.
  useEffect(() => {
    if (confirming) reviewRef.current?.focus()
  }, [confirming])

  const edit = (field: Field, setter: (v: string) => void) => (v: string) => {
    setter(v)
    setTouched((t) => (t.has(field) ? t : new Set(t).add(field)))
    setConfirming(false)
    setError(null)
  }

  const save = async () => {
    if (pending || !online) return
    setPending(true)
    setError(null)
    try {
      await addManualSession(user.uid, input)
      toast.show('Horas añadidas al registro.', 'success')
      onClose()
    } catch (e) {
      const message = friendlyError(e)
      setError(message)
      announcer.announce(`No se han guardado las horas: ${message}`)
      setPending(false)
      setConfirming(false)
    }
  }

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setAttempted(true)
    if (errors.length > 0) {
      announcer.announce(`No se puede guardar todavía: ${errors.join(' ')}`)
      return
    }
    if (pending || !online) return
    if (warnings.length > 0 && !confirming) {
      confirmSince.current = Date.now()
      setConfirming(true)
      announcer.announce(`Antes de guardar, revisa estos avisos: ${warnings.join(' ')}`)
      return
    }
    if (confirming && Date.now() - confirmSince.current < CONFIRM_GUARD_MS) return
    void save()
  }

  return (
    <Modal
      title="Añadir horas a mano"
      description="Para días en los que no pudiste fichar en vivo."
      onClose={onClose}
      busy={pending}
      dismissOnBackdrop={false}
      initialFocus={dateRef}
      footer={
        confirming ? (
          <>
            <button
              key="review"
              ref={reviewRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setConfirming(false)
                dateRef.current?.focus()
              }}
              disabled={pending}
            >
              Revisar
            </button>
            <button key="confirm" type="submit" form={formId} className="btn btn-primary" disabled={pending || !online}>
              {pending ? 'Guardando…' : 'Guardar igualmente'}
            </button>
          </>
        ) : (
          <>
            <button key="cancel" type="button" className="btn btn-secondary" onClick={onClose} disabled={pending}>
              Cancelar
            </button>
            <button
              key="save"
              type="submit"
              form={formId}
              className="btn btn-primary"
              disabled={pending || !online || (attempted && errors.length > 0)}
            >
              {pending ? 'Guardando…' : 'Guardar'}
            </button>
          </>
        )
      }
    >
      <form id={formId} className="form" onSubmit={handleSubmit} noValidate>
        <div className="field-grid">
          <TextField
            ref={dateRef}
            label="Fecha"
            type="date"
            required
            min={minKey}
            max={todayKey}
            value={date}
            onChange={(e) => edit('date', setDate)(e.target.value)}
            disabled={pending}
            error={show('date', 'time') ? byField.date : null}
          />
          <TextField
            label="Hora"
            optional
            type="time"
            value={time}
            onChange={(e) => edit('time', setTime)(e.target.value)}
            disabled={pending}
            error={show('time') ? byField.time : null}
          />
        </div>
        <p className="field-hint form-note">
          Hora de inicio. Sin hora se registra a las {DEFAULT_MANUAL_TIME}. En el historial, el horario de las entradas
          manuales se muestra como aproximado.
        </p>

        <fieldset className="fieldset">
          <legend className="field-label">Duración</legend>
          <div className="field-grid">
            <TextField
              label="Horas"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              value={hours}
              onChange={(e) => edit('hours', setHours)(e.target.value)}
              disabled={pending}
              error={
                show('hours')
                  ? (hoursError ?? byField.duration ?? (show('minutes') ? zeroError : null))
                  : null
              }
            />
            <TextField
              label="Minutos"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              placeholder="0"
              value={minutes}
              onChange={(e) => edit('minutes', setMinutes)(e.target.value)}
              disabled={pending}
              error={show('minutes') ? minutesError : null}
            />
          </div>
          <p className="field-hint">Máximo {MAX_SESSION_HOURS} h por entrada.</p>
        </fieldset>

        <TextAreaField
          label="Nota"
          hint={`Obligatoria (mínimo ${MIN_MANUAL_NOTE} caracteres): qué hiciste y por qué no fichaste.`}
          rows={3}
          maxCount={MAX_NOTE}
          required
          value={note}
          onChange={(e) => edit('note', setNote)(e.target.value)}
          disabled={pending}
          error={show('note') ? byField.note : null}
        />

        {preview && (
          <Notice kind="info">
            <p>
              Se registrará el <strong>{preview.day}</strong>, de {preview.from} a {preview.to}
              {preview.nextDay ? ' (día siguiente)' : ''}
              {time ? '' : ' (aprox.)'}: <strong className="tabular">{preview.duration}</strong>.
            </p>
          </Notice>
        )}

        <div className="stack">
          {attempted && errors.length > 0 && (
            <Notice kind="error" title="Falta algo para poder guardar">
              <MessageList items={errors} />
            </Notice>
          )}
          {warnings.length > 0 && (
            <Notice kind="warn" title={confirming ? '¿Guardar igualmente?' : 'Ten en cuenta'}>
              <MessageList items={warnings} />
              {confirming && <p>Tu profesora verá estas marcas en el historial.</p>}
            </Notice>
          )}
          {error && (
            <Notice kind="error" title="No se han guardado las horas">
              <p>{error}</p>
            </Notice>
          )}
          {!online && <Notice kind="warn">Sin conexión: no se pueden guardar horas ahora.</Notice>}
        </div>
        <LiveMessage announcement={announcer.announcement} />
      </form>
    </Modal>
  )
}
