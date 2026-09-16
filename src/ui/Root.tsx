import { lazy, StrictMode, Suspense } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { LoadingScreen } from './LoadingScreen'
import { SetupScreen } from './SetupScreen'

function isFirebaseInitError(e: unknown): e is Error {
  return e instanceof Error && e.name === 'FirebaseError'
}

// App se carga aparte. Sin configuración, App muestra SetupScreen por su cuenta; si la configuración
// no es válida y el SDK lanza al importar src/data/firebase.ts, se muestran igualmente las
// instrucciones (con el detalle) en vez de una página en blanco.
const App = lazy(() =>
  import('../App.tsx').catch((e: unknown) => {
    if (!isFirebaseInitError(e)) throw e
    console.error(e)
    const detail = e.message
    return { default: () => <SetupScreen detail={detail} /> }
  }),
)

export function Root() {
  return (
    <StrictMode>
      <ErrorBoundary>
        <Suspense fallback={<LoadingScreen />}>
          <App />
        </Suspense>
      </ErrorBoundary>
    </StrictMode>
  )
}
