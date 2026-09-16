import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from './icons'
import './modal.css'

// Pila de diálogos abiertos: solo el de arriba es interactivo; el resto de la página queda `inert`.
const stack: HTMLElement[] = []

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest('[inert]'),
  )
}

function syncStack() {
  const top = stack[stack.length - 1]
  const root = document.getElementById('root')
  if (root) root.inert = stack.length > 0
  for (const el of stack) el.inert = el !== top
  document.documentElement.style.overflow = stack.length > 0 ? 'hidden' : ''
  // toast.css sube los avisos por encima del pie de los diálogos en móvil
  document.documentElement.classList.toggle('modal-open', stack.length > 0)
}

export interface ModalProps {
  title: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  /** Texto breve bajo el título (aria-describedby). */
  description?: ReactNode
  wide?: boolean
  /** Mientras es true no se puede cerrar (operación pendiente). */
  busy?: boolean
  /** Cerrar al pulsar fuera. Por defecto sí; en formularios conviene no. */
  dismissOnBackdrop?: boolean
  /** Elemento que recibe el foco al abrir. Por defecto, el propio diálogo. */
  initialFocus?: RefObject<HTMLElement | null>
  /** 'alertdialog' para confirmaciones. */
  role?: 'dialog' | 'alertdialog'
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  description,
  wide = false,
  busy = false,
  dismissOnBackdrop = true,
  initialFocus,
  role = 'dialog',
}: ModalProps) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const pressedOnBackdrop = useRef(false)
  const titleId = useId()
  const descId = useId()

  // Solo al montar/desmontar: registrar en la pila, mover el foco y devolverlo al cerrar.
  useEffect(() => {
    const backdrop = backdropRef.current
    const dialog = dialogRef.current
    if (!backdrop || !dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    stack.push(backdrop)
    syncStack()
    const target = initialFocus?.current ?? dialog
    target.focus({ preventScroll: target === dialog })
    return () => {
      const i = stack.indexOf(backdrop)
      if (i >= 0) stack.splice(i, 1)
      syncStack()
      if (previous?.isConnected) {
        previous.focus({ preventScroll: true })
      } else {
        // El control que abrió el diálogo ya no existe: el foco vuelve al diálogo que quede debajo.
        stack[stack.length - 1]?.querySelector<HTMLElement>('.modal')?.focus({ preventScroll: true })
      }
    }
    // initialFocus es un ref (estable): el efecto solo corre al montar.
  }, [initialFocus])

  // Si el control con el foco desaparece (p. ej. "Anular sesión…" tras anular), el navegador lo manda
  // a <body> y Escape/Tab dejarían de funcionar: el foco vuelve al diálogo.
  useEffect(() => {
    const backdrop = backdropRef.current
    const dialog = dialogRef.current
    if (!backdrop || !dialog) return
    const observer = new MutationObserver(() => {
      const lost = document.activeElement === null || document.activeElement === document.body
      if (lost && stack[stack.length - 1] === backdrop) dialog.focus({ preventScroll: true })
    })
    observer.observe(dialog, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])

  const isTop = () => stack[stack.length - 1] === backdropRef.current

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Los eventos de React burbujean entre portales anidados: solo actúa el diálogo superior.
    if (!isTop()) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      e.preventDefault()
      if (!busy) onClose()
      return
    }
    if (e.key !== 'Tab') return
    const dialog = dialogRef.current
    if (!dialog) return
    const items = focusableIn(dialog)
    if (items.length === 0) {
      e.preventDefault()
      dialog.focus()
      return
    }
    const first = items[0]
    const last = items[items.length - 1]
    const active = document.activeElement
    if (e.shiftKey && (active === first || active === dialog)) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const handleMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    const onBackdrop = e.target === e.currentTarget
    pressedOnBackdrop.current = onBackdrop
    // El fondo no es enfocable: sin esto el foco se iría a <body> y Escape/Tab dejarían de funcionar
    if (onBackdrop) e.preventDefault()
  }

  const handleClick = (e: MouseEvent<HTMLDivElement>) => {
    const fromBackdrop = pressedOnBackdrop.current && e.target === e.currentTarget
    pressedOnBackdrop.current = false
    if (fromBackdrop && dismissOnBackdrop && !busy && isTop()) onClose()
  }

  return createPortal(
    <div
      ref={backdropRef}
      className="modal-backdrop"
      onKeyDown={handleKeyDown}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div
        ref={dialogRef}
        className={wide ? 'modal modal-wide' : 'modal'}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div className="modal-heading">
            <h2 id={titleId} className="modal-title">
              {title}
            </h2>
            {description && (
              <p id={descId} className="modal-description">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
          >
            <IconClose />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
