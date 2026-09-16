import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AppIcon, APP_NAME, Disclaimer } from './Brand'
import { IconAlertCircle, IconRefresh } from './icons'
import './screens.css'

interface State {
  error: Error | null
}

/** Última red de seguridad: un error de render muestra esta pantalla en vez de una página en blanco. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Error no controlado en la interfaz', error, info.componentStack)
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <main className="screen">
        <div className="screen-inner">
          <div className="screen-brand">
            <AppIcon size={48} />
            <p className="screen-title">{APP_NAME}</p>
          </div>
          <section className="card screen-card stack" aria-labelledby="fatal-title">
            <div className="screen-icon screen-icon-danger">
              <IconAlertCircle size={28} />
            </div>
            <h1 id="fatal-title" className="screen-card-title">
              Algo ha fallado
            </h1>
            <p>
              La aplicación ha encontrado un error inesperado. Tus datos están guardados en el servidor: recarga la página
              para volver a intentarlo.
            </p>
            <p className="error-detail">{error.message}</p>
            <button type="button" className="btn btn-primary btn-block" onClick={() => window.location.reload()}>
              <IconRefresh size={18} />
              Recargar
            </button>
          </section>
          <Disclaimer className="screen-disclaimer" />
        </div>
      </main>
    )
  }
}
