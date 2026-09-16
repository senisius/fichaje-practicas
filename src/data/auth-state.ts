// Estado de autenticación: onAuthStateChanged + lectura de users/{uid}, con reintentos.
// Va aparte del hook useAuthState para poder probarlo sin React.
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import type { AppUser, Role, UserDoc } from '../types'
import { errorCode } from './api'
import { auth, db } from './firebase'

const ROLES: readonly Role[] = ['student', 'supervisor', 'backup']

/** Fallos seguidos al leer el perfil a partir de los cuales se avisa de que no hay conexión con el servidor. */
export const UNREACHABLE_AFTER_FAILURES = 2

export type AuthState =
  /** `unreachable`: el perfil no se puede leer (sin conexión con el servidor); se sigue reintentando. */
  | { status: 'loading'; unreachable?: boolean }
  | { status: 'signed-out' }
  /** Hay sesión de Firebase Auth pero no existe users/{uid} (o no se puede leer). */
  | { status: 'no-profile'; uid: string; email: string | null }
  | { status: 'ready'; user: AppUser }

/** Espera antes del reintento n (0, 1, 2…): 1 s, 2 s, 4 s… hasta 30 s. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** attempt)
}

/**
 * Llama a onChange con cada estado nuevo. Los errores transitorios al leer el perfil se reintentan sin
 * fin (también al volver la conexión); tras UNREACHABLE_AFTER_FAILURES fallos el estado de carga lo indica.
 */
export function subscribeAuthState(onChange: (state: AuthState) => void): () => void {
  // Cada cambio de usuario abre una "generación"; las respuestas de generaciones viejas se ignoran
  let generation = 0
  let current: AuthState = { status: 'loading' }
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let removeOnline: (() => void) | undefined
  const emit = (next: AuthState) => {
    current = next
    onChange(next)
  }
  const clearRetry = () => {
    clearTimeout(retryTimer)
    retryTimer = undefined
    removeOnline?.()
    removeOnline = undefined
  }

  const unsubscribe = onAuthStateChanged(auth, (fbUser) => {
    const gen = ++generation
    clearRetry()
    if (!fbUser) {
      emit({ status: 'signed-out' })
      return
    }
    const { uid, email } = fbUser
    // Si es el mismo usuario ya cargado, no se vuelve a la pantalla de carga
    if (!(current.status === 'ready' && current.user.uid === uid)) emit({ status: 'loading' })

    const load = (attempt: number): void => {
      getDoc(doc(db, 'users', uid)).then(
        (snap) => {
          if (gen !== generation) return
          const data = snap.exists() ? (snap.data() as UserDoc) : null
          if (!data || !ROLES.includes(data.role)) {
            emit({ status: 'no-profile', uid, email })
            return
          }
          emit({ status: 'ready', user: { ...data, uid } })
        },
        (err: unknown) => {
          if (gen !== generation) return
          const code = errorCode(err)
          // Sin documento users/{uid} las reglas deniegan la lectura
          if (code === 'permission-denied' || code === 'not-found') {
            emit({ status: 'no-profile', uid, email })
            return
          }
          // Error transitorio (sin conexión…): se sigue cargando y se reintenta
          if (attempt + 1 >= UNREACHABLE_AFTER_FAILURES && current.status === 'loading' && !current.unreachable) {
            emit({ status: 'loading', unreachable: true })
          }
          const retry = () => {
            if (gen !== generation) return
            clearRetry()
            load(attempt + 1)
          }
          retryTimer = setTimeout(retry, retryDelayMs(attempt))
          if (typeof window !== 'undefined') {
            window.addEventListener('online', retry)
            removeOnline = () => window.removeEventListener('online', retry)
          }
        },
      )
    }
    load(0)
  })

  return () => {
    generation++
    clearRetry()
    unsubscribe()
  }
}
