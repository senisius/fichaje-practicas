import { firebaseConfigured } from './data/firebase'
import { AppDataProvider, useAuthState, useOnline, type AuthState } from './data/AppDataProvider'
import { AppShell } from './ui/AppShell'
import { LoadingScreen } from './ui/LoadingScreen'
import { LoginScreen } from './ui/LoginScreen'
import { NoProfileScreen, TechnicalAccountScreen } from './ui/NoProfileScreen'
import { SetupScreen } from './ui/SetupScreen'
import { ToastProvider } from './ui/Toast'

export default function App() {
  if (!firebaseConfigured) return <SetupScreen />
  return (
    <ToastProvider>
      <AuthGate />
    </ToastProvider>
  )
}

function AuthGate() {
  return <AuthScreen auth={useAuthState()} />
}

/** Pantalla según el estado de autenticación. */
export function AuthScreen({ auth }: { auth: AuthState }) {
  const online = useOnline()
  switch (auth.status) {
    case 'loading':
      if (auth.unreachable) {
        return (
          <LoadingScreen
            label="Comprobando la sesión…"
            notice={
              !online
                ? 'Sin conexión a internet. Se reintentará automáticamente cuando vuelva.'
                : 'No se puede conectar con el servidor. Se sigue reintentando automáticamente.'
            }
            onRetry={() => window.location.reload()}
          />
        )
      }
      return <LoadingScreen label="Comprobando la sesión…" />
    case 'signed-out':
      return <LoginScreen />
    case 'no-profile':
      return <NoProfileScreen email={auth.email} />
    case 'ready':
      if (auth.user.role === 'backup') return <TechnicalAccountScreen user={auth.user} />
      return (
        <AppDataProvider key={auth.user.uid} user={auth.user}>
          <AppShell user={auth.user} />
        </AppDataProvider>
      )
  }
}
