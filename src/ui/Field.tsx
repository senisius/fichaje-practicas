import { useId, useState, type ComponentProps, type ReactNode } from 'react'
import { IconAlertCircle, IconEye, IconEyeOff } from './icons'

interface FieldBase {
  label: ReactNode
  hint?: ReactNode
  /** Mensaje de error del campo (se asocia con aria-describedby). */
  error?: string | null
  optional?: boolean
  /** Muestra "n / max" bajo el campo. */
  maxCount?: number
}

function describedBy(...ids: (string | null)[]): string | undefined {
  const list = ids.filter(Boolean)
  return list.length ? list.join(' ') : undefined
}

function FieldFooter({
  hintId,
  errorId,
  hint,
  error,
  count,
  maxCount,
}: {
  hintId: string
  errorId: string
  hint?: ReactNode
  error?: string | null
  count: number
  maxCount?: number
}) {
  return (
    <>
      {hint && (
        <p id={hintId} className="field-hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="field-error">
          <IconAlertCircle size={16} />
          <span>{error}</span>
        </p>
      )}
      {maxCount !== undefined && (
        <p className="field-counter" aria-hidden="true">
          {count.toLocaleString('es-ES')} / {maxCount.toLocaleString('es-ES')}
        </p>
      )}
    </>
  )
}

function Label({ htmlFor, label, optional }: { htmlFor: string; label: ReactNode; optional?: boolean }) {
  return (
    <label htmlFor={htmlFor} className="field-label">
      {label}
      {optional && <span className="field-optional"> (opcional)</span>}
    </label>
  )
}

export function TextField({
  label,
  hint,
  error,
  optional,
  maxCount,
  id,
  className,
  ...input
}: FieldBase & ComponentProps<'input'>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  return (
    <div className="field">
      <Label htmlFor={inputId} label={label} optional={optional} />
      <input
        id={inputId}
        className={className ? `input ${className}` : 'input'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : null, error ? errorId : null)}
        maxLength={maxCount}
        {...input}
      />
      <FieldFooter
        hintId={hintId}
        errorId={errorId}
        hint={hint}
        error={error}
        count={String(input.value ?? '').length}
        maxCount={maxCount}
      />
    </div>
  )
}

export function TextAreaField({
  label,
  hint,
  error,
  optional,
  maxCount,
  id,
  className,
  ...textarea
}: FieldBase & ComponentProps<'textarea'>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  return (
    <div className="field">
      <Label htmlFor={inputId} label={label} optional={optional} />
      <textarea
        id={inputId}
        className={className ? `textarea ${className}` : 'textarea'}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(hint ? hintId : null, error ? errorId : null)}
        maxLength={maxCount}
        {...textarea}
      />
      <FieldFooter
        hintId={hintId}
        errorId={errorId}
        hint={hint}
        error={error}
        count={String(textarea.value ?? '').length}
        maxCount={maxCount}
      />
    </div>
  )
}

/** Campo de contraseña con botón para mostrarla. */
export function PasswordField({
  label,
  hint,
  error,
  id,
  ...input
}: Omit<FieldBase, 'maxCount' | 'optional'> & Omit<ComponentProps<'input'>, 'type'>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const hintId = `${inputId}-hint`
  const errorId = `${inputId}-error`
  const [visible, setVisible] = useState(false)
  return (
    <div className="field">
      <Label htmlFor={inputId} label={label} />
      <div className="input-with-action">
        <input
          id={inputId}
          className="input"
          type={visible ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(hint ? hintId : null, error ? errorId : null)}
          {...input}
        />
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          disabled={input.disabled}
        >
          {visible ? <IconEyeOff /> : <IconEye />}
          <span className="visually-hidden">Mostrar contraseña</span>
        </button>
      </div>
      <FieldFooter hintId={hintId} errorId={errorId} hint={hint} error={error} count={0} />
    </div>
  )
}
