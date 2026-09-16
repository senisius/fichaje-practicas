import type { ReactNode } from 'react'
import { IconAlert, IconAlertCircle, IconCheckCircle, IconInfo, IconRefresh } from './icons'
import type { Announcement } from './submit-announcer'

export type NoticeKind = 'info' | 'warn' | 'error' | 'success'

const ICONS = {
  info: IconInfo,
  warn: IconAlert,
  error: IconAlertCircle,
  success: IconCheckCircle,
} as const

export function Notice({
  kind = 'info',
  title,
  children,
  actions,
  role,
  id,
  className,
}: {
  kind?: NoticeKind
  title?: ReactNode
  children?: ReactNode
  actions?: ReactNode
  /** 'alert' para errores que deben anunciarse en cuanto aparecen. */
  role?: 'alert' | 'status'
  id?: string
  className?: string
}) {
  const Icon = ICONS[kind]
  return (
    <div id={id} className={`notice notice-${kind}${className ? ` ${className}` : ''}`} role={role}>
      <Icon />
      <div className="notice-body">
        {title && <p className="notice-title">{title}</p>}
        {children}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  )
}

/** Región aria-live oculta con el último anuncio de un formulario (useSubmitAnnouncer). */
export function LiveMessage({ announcement }: { announcement: Announcement }) {
  return (
    <p className="visually-hidden" aria-live="polite">
      {announcement.text}
      {/* Un espacio duro alterno hace que se vuelva a anunciar un texto idéntico */}
      {announcement.n % 2 === 1 ? '\u00a0' : ''}
    </p>
  )
}

/** Lista de mensajes (errores o avisos de validación) dentro de un aviso. */
export function MessageList({ items }: { items: string[] }) {
  if (items.length === 1) return <p>{items[0]}</p>
  return (
    <ul>
      {items.map((m) => (
        <li key={m}>{m}</li>
      ))}
    </ul>
  )
}

/** Error de una operación o de carga, con reintento opcional. */
export function ErrorNotice({
  message,
  onRetry,
  title = 'No se ha podido completar',
}: {
  message: string
  onRetry?: () => void
  title?: string
}) {
  return (
    <Notice
      kind="error"
      role="alert"
      title={title}
      actions={
        onRetry && (
          <button type="button" className="btn btn-secondary" onClick={onRetry}>
            <IconRefresh size={18} />
            Reintentar
          </button>
        )
      }
    >
      <p>{message}</p>
    </Notice>
  )
}

export function EmptyState({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div className="empty-state-icon">{icon}</div>
      <p className="empty-state-title">{title}</p>
      {children && <div className="small">{children}</div>}
    </div>
  )
}

export function Skeleton({ width = '100%', height = 16, className }: { width?: number | string; height?: number | string; className?: string }) {
  return <span className={className ? `skeleton ${className}` : 'skeleton'} style={{ width, height }} aria-hidden="true" />
}
