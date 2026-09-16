import { IconRefresh, IconWifiOff } from './icons'
import './screens.css'

interface Props {
  label?: string
  /** Aviso bajo el indicador (p. ej. que no hay conexión con el servidor). */
  notice?: string
  /** Muestra un botón para reintentar ya. */
  onRetry?: () => void
}

export function LoadingScreen({ label = 'Cargando…', notice, onRetry }: Props) {
  return (
    <main className="screen loading-screen" aria-busy="true">
      <div className="spinner" aria-hidden="true" />
      <p role="status">{label}</p>
      {notice && (
        <div className="loading-notice" role="alert">
          <IconWifiOff size={18} />
          <p>{notice}</p>
        </div>
      )}
      {onRetry && (
        <button type="button" className="btn btn-secondary" onClick={onRetry}>
          <IconRefresh size={18} />
          Reintentar
        </button>
      )}
    </main>
  )
}
