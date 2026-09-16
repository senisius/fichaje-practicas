import { useRef, useState, type FormEvent } from 'react'
import { friendlyError, sendPasswordReset, signIn } from '../data/api'
import { useOnline } from '../data/AppDataProvider'
import { AppIcon, APP_NAME, Disclaimer } from './Brand'
import { PasswordField, TextField } from './Field'
import { IconArrowLeft, IconInfo, IconMail } from './icons'
import { Notice } from './Notice'
import './screens.css'

type Mode = 'login' | 'reset'

export function LoginScreen() {
  const online = useOnline()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resetSentTo, setResetSentTo] = useState<string | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)

  const switchMode = (next: Mode) => {
    setMode(next)
    setError(null)
    setResetSentTo(null)
    // El foco pasa al nuevo título para no perderse al cambiar de formulario.
    requestAnimationFrame(() => headingRef.current?.focus())
  }

  const handleLogin = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending) return
    if (!email.trim() || !password) {
      setError('Escribe tu correo y tu contraseña.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await signIn(email.trim(), password)
      // Si va bien, la app cambia de pantalla sola (useAuthState).
    } catch (err) {
      setError(friendlyError(err))
      setPending(false)
    }
  }

  const handleReset = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pending) return
    const target = email.trim()
    if (!target) {
      setError('Escribe el correo con el que accedes.')
      return
    }
    setPending(true)
    setError(null)
    try {
      await sendPasswordReset(target)
      setResetSentTo(target)
    } catch (err) {
      setError(friendlyError(err))
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="screen">
      <div className="screen-inner">
        <div className="screen-brand">
          <AppIcon size={64} />
          <h1 className="screen-title">{APP_NAME}</h1>
          <p className="screen-subtitle">Registro de horas de prácticas</p>
        </div>

        <section className="card screen-card" aria-labelledby="login-title">
          {mode === 'login' ? (
            <form className="form" onSubmit={handleLogin} noValidate>
              <h2 id="login-title" ref={headingRef} tabIndex={-1} className="screen-card-title">
                Iniciar sesión
              </h2>
              <TextField
                label="Correo electrónico"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={pending}
              />
              <PasswordField
                label="Contraseña"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={pending}
                hint="La contraseña de esta herramienta, no la de la UAB."
              />
              <div aria-live="polite">{error && <Notice kind="error">{error}</Notice>}</div>
              <button type="submit" className="btn btn-primary btn-block" disabled={pending || !online}>
                {pending ? 'Entrando…' : 'Entrar'}
              </button>
              <button type="button" className="btn btn-link" onClick={() => switchMode('reset')} disabled={pending}>
                He olvidado mi contraseña
              </button>
            </form>
          ) : (
            <form className="form" onSubmit={handleReset} noValidate>
              <h2 id="login-title" ref={headingRef} tabIndex={-1} className="screen-card-title">
                Restablecer la contraseña
              </h2>
              <p className="muted small">
                Te enviaremos un correo con un enlace para crear una contraseña nueva. Puede tardar unos minutos y a
                veces llega a la carpeta de spam.
              </p>
              <TextField
                label="Correo electrónico"
                type="email"
                name="email"
                autoComplete="username"
                inputMode="email"
                autoCapitalize="none"
                spellCheck={false}
                required
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value)
                  setResetSentTo(null)
                }}
                disabled={pending}
              />
              <div aria-live="polite">
                {error && <Notice kind="error">{error}</Notice>}
                {resetSentTo && (
                  <Notice kind="success" title="Solicitud enviada">
                    <p>
                      Si <strong>{resetSentTo}</strong> tiene acceso, recibirás un enlace para restablecer la
                      contraseña. Revisa también la carpeta de spam.
                    </p>
                  </Notice>
                )}
              </div>
              <button type="submit" className="btn btn-primary btn-block" disabled={pending || !online}>
                <IconMail size={18} />
                {pending ? 'Enviando…' : 'Enviar enlace'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => switchMode('login')} disabled={pending}>
                <IconArrowLeft size={18} />
                Volver a iniciar sesión
              </button>
            </form>
          )}
        </section>

        <div aria-live="polite">
          {!online && (
            <Notice kind="warn" title="Sin conexión">
              <p>Necesitas conexión a internet para iniciar sesión.</p>
            </Notice>
          )}
        </div>

        <div className="notice notice-info">
          <IconInfo />
          <div className="notice-body">
            <Disclaimer />
            <p className="muted small">No hay registro abierto: las cuentas las da de alta el administrador.</p>
          </div>
        </div>
      </div>
    </main>
  )
}
