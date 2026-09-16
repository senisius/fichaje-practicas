import { useState, type ReactNode } from 'react'
import { friendlyError, signOutUser } from '../data/api'
import type { AppUser } from '../types'
import { AppIcon, APP_NAME, Disclaimer } from './Brand'
import { IconDatabase, IconLock, IconLogout } from './icons'
import { Notice } from './Notice'
import './screens.css'

function AccountScreen({
  icon,
  title,
  children,
}: {
  icon: ReactNode
  title: string
  children: ReactNode
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignOut = async () => {
    setPending(true)
    setError(null)
    try {
      await signOutUser()
    } catch (e) {
      setError(friendlyError(e))
      setPending(false)
    }
  }

  return (
    <main className="screen">
      <div className="screen-inner">
        <div className="screen-brand">
          <AppIcon size={48} />
          <p className="screen-title">{APP_NAME}</p>
        </div>
        <section className="card screen-card stack" aria-labelledby="account-title">
          <div className="screen-icon screen-icon-warn">{icon}</div>
          <h1 id="account-title" className="screen-card-title">
            {title}
          </h1>
          {children}
          <div aria-live="polite">{error && <Notice kind="error">{error}</Notice>}</div>
          <button type="button" className="btn btn-secondary btn-block" onClick={handleSignOut} disabled={pending}>
            <IconLogout size={18} />
            {pending ? 'Cerrando sesión…' : 'Cerrar sesión'}
          </button>
        </section>
        <Disclaimer className="screen-disclaimer" />
      </div>
    </main>
  )
}

/** Hay sesión de Firebase pero no existe users/{uid}. */
export function NoProfileScreen({ email }: { email: string | null }) {
  return (
    <AccountScreen icon={<IconLock size={28} />} title="Tu cuenta no tiene acceso">
      <p>
        {email ? (
          <>
            La cuenta <strong>{email}</strong> no está dada de alta en esta herramienta.
          </>
        ) : (
          'Esta cuenta no está dada de alta en esta herramienta.'
        )}{' '}
        Pide al administrador que la dé de alta.
      </p>
    </AccountScreen>
  )
}

/** La cuenta técnica de copias de seguridad no usa la interfaz. */
export function TechnicalAccountScreen({ user }: { user: AppUser }) {
  return (
    <AccountScreen icon={<IconDatabase size={28} />} title="Cuenta técnica">
      <p>
        {user.email ? <strong>{user.email}</strong> : 'Esta cuenta'} es la cuenta de copias de seguridad automáticas.
        Solo la usa el proceso de backup y no tiene pantallas en la aplicación.
      </p>
    </AccountScreen>
  )
}
