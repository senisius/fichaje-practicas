import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconAlertCircle, IconCheckCircle, IconClose, IconInfo } from './icons'
import { ToastContext, type ToastApi, type ToastKind } from './toast-context'
import './toast.css'

interface ToastItem {
  id: number
  message: string
  kind: ToastKind
}

const DURATION: Record<ToastKind, number> = { success: 4000, info: 5000, error: 9000 }

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, number>())

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id)
    if (t !== undefined) window.clearTimeout(t)
    timers.current.delete(id)
    setItems((xs) => xs.filter((x) => x.id !== id))
  }, [])

  const show = useCallback(
    (message: string, kind: ToastKind = 'success') => {
      const id = nextId.current++
      // Máximo 3 a la vez: los más antiguos se descartan.
      setItems((xs) => [...xs.filter((x) => x.message !== message).slice(-2), { id, message, kind }])
      timers.current.set(
        id,
        window.setTimeout(() => dismiss(id), DURATION[kind]),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const map = timers.current
    return () => {
      for (const t of map.values()) window.clearTimeout(t)
      map.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ show }), [show])
  const polite = items.filter((x) => x.kind !== 'error')
  const assertive = items.filter((x) => x.kind === 'error')

  // Fuera de #root: así no queda `inert` mientras hay un diálogo abierto y se sigue anunciando.
  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div className="toasts">
          <div role="status" aria-live="polite" className="toast-region">
            {polite.map((t) => (
              <Toast key={t.id} item={t} onDismiss={dismiss} />
            ))}
          </div>
          <div role="alert" aria-live="assertive" className="toast-region">
            {assertive.map((t) => (
              <Toast key={t.id} item={t} onDismiss={dismiss} />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  )
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const Icon = item.kind === 'error' ? IconAlertCircle : item.kind === 'info' ? IconInfo : IconCheckCircle
  return (
    <div className={`toast toast-${item.kind}`}>
      <Icon />
      <p className="toast-message">{item.message}</p>
      <button type="button" className="btn btn-ghost btn-icon toast-close" onClick={() => onDismiss(item.id)}>
        <IconClose size={18} />
        <span className="visually-hidden">Cerrar aviso</span>
      </button>
    </div>
  )
}
