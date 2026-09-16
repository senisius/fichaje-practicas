// Datos compartidos por toda la app. Una sola suscripción por colección (se crean al entrar y se
// limpian al salir). El estado se reinicia por completo al cambiar de usuario.
// La lógica de suscripciones está en sources.ts y la de autenticación en auth-state.ts.
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import type { AppUser, BackupMeta, Comment, Revision, Session } from '../types'
import { getClockSample, setServerSkewMs, skewFromSample, subscribeClockSample } from './api'
import { subscribeAuthState, type AuthState } from './auth-state'
import {
  SOURCE_KEYS,
  failedSources,
  initialData,
  loadRevisions,
  readErrorMessage,
  reducer,
  subscribeSources,
  type SourceKey,
} from './sources'

// ---------- Autenticación ----------

export type { AuthState }

/** onAuthStateChanged + lectura de users/{uid}. */
export function useAuthState(): AuthState {
  const [state, setState] = useState<AuthState>({ status: 'loading' })
  useEffect(() => subscribeAuthState(setState), [])
  return state
}

// ---------- Datos de la app ----------

export type DataSource = SourceKey

export interface AppData {
  /** true hasta que llegan los primeros datos (del servidor) de todas las suscripciones. */
  loading: boolean
  /** Mensaje en español si falla alguna suscripción. */
  error: string | null
  /** Suscripciones que han fallado: sus datos se muestran vacíos y no son fiables. */
  failed: readonly DataSource[]
  users: AppUser[]
  /** El usuario con role 'student' (hay uno solo). */
  student: AppUser | null
  /** Sesiones visibles para el usuario actual, ordenadas por start_time descendente. */
  sessions: Session[]
  /** Sesión en curso del student (vía live/{uid}); null si no hay. */
  openSession: Session | null
  /** Comentarios ordenados por created_at ascendente. */
  comments: Comment[]
  commentsBySession: Map<string, Comment[]>
  backup: BackupMeta | null
  /** Hora servidor - hora cliente (ms), estimada; 0 si no hay dato. */
  serverSkewMs: number
}

const AppDataContext = createContext<AppData | null>(null)

export function AppDataProvider(props: { user: AppUser; children: ReactNode }): ReactNode {
  // La clave fuerza un estado nuevo (y suscripciones nuevas) para cada usuario
  return (
    <DataScope key={`${props.user.uid}:${props.user.role}`} user={props.user}>
      {props.children}
    </DataScope>
  )
}

function DataScope({ user, children }: { user: AppUser; children: ReactNode }): ReactNode {
  const [raw, dispatch] = useReducer(reducer, initialData)
  const { uid, role } = user

  useEffect(() => subscribeSources(uid, role, dispatch), [uid, role])

  // Desfase del reloj: muestra del clic en EMPEZAR frente al start_time confirmado por el servidor
  const sample = useSyncExternalStore(subscribeClockSample, getClockSample, () => null)
  const serverSkewMs = useMemo(() => {
    if (!sample || sample.uid !== uid || !raw.confirmed.has(sample.sessionId)) return 0
    const s = raw.sessions.find((x) => x.id === sample.sessionId)
    return s ? skewFromSample(sample, s.start_time.toMillis()) : 0
  }, [sample, uid, raw.sessions, raw.confirmed])

  useEffect(() => {
    setServerSkewMs(serverSkewMs)
    return () => setServerSkewMs(0)
  }, [serverSkewMs])

  const value = useMemo<AppData>(() => {
    const student = raw.users.find((u) => u.role === 'student') ?? (user.role === 'student' ? user : null)
    const openId = student ? raw.live.get(student.uid) : undefined
    const openSession = openId ? (raw.sessions.find((s) => s.id === openId && s.end_time == null) ?? null) : null
    const commentsBySession = new Map<string, Comment[]>()
    for (const c of raw.comments) {
      const list = commentsBySession.get(c.session_id)
      if (list) list.push(c)
      else commentsBySession.set(c.session_id, [c])
    }
    const firstError = SOURCE_KEYS.map((k) => raw.errors[k]).find((m) => m !== undefined) ?? null
    return {
      loading: !SOURCE_KEYS.every((k) => raw.loaded[k]),
      error: firstError,
      failed: failedSources(raw),
      users: raw.users,
      student,
      sessions: raw.sessions,
      openSession,
      comments: raw.comments,
      commentsBySession,
      backup: raw.backup,
      serverSkewMs,
    }
  }, [raw, user, serverSkewMs])

  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData() debe usarse dentro de <AppDataProvider>.')
  return ctx
}

// ---------- Revisiones ----------

interface RevisionsResult {
  sessionId: string | null
  key: string | null
  revisions: Revision[]
  error: string | null
}

/**
 * Revisiones de una sesión (lectura puntual del servidor al abrir el detalle), ordenadas por número.
 * Se recargan cuando cambia la sesión o su `rev` (tomado de `rev` o, si no se pasa, del contexto).
 * Sin conexión devuelven un error (con reintento en la interfaz), nunca la lista vacía de la caché.
 */
export function useRevisions(
  sessionId: string | null,
  rev?: number,
): {
  revisions: Revision[]
  loading: boolean
  error: string | null
} {
  const ctx = useContext(AppDataContext)
  const ctxRev = sessionId && ctx ? ctx.sessions.find((s) => s.id === sessionId)?.rev : undefined
  const currentRev = rev ?? ctxRev
  const key = sessionId === null ? null : `${sessionId}#${currentRev ?? '?'}`
  const [result, setResult] = useState<RevisionsResult>({ sessionId: null, key: null, revisions: [], error: null })

  useEffect(() => {
    if (sessionId === null || key === null) return
    let cancelled = false
    loadRevisions(sessionId).then(
      (revisions) => {
        if (!cancelled) setResult({ sessionId, key, revisions, error: null })
      },
      (err: unknown) => {
        if (!cancelled) setResult({ sessionId, key, revisions: [], error: readErrorMessage(err) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [sessionId, key])

  if (sessionId === null) return { revisions: [], loading: false, error: null }
  const fresh = result.key === key
  // Mientras se recarga la misma sesión se siguen mostrando las revisiones anteriores
  const sameSession = result.sessionId === sessionId
  return {
    revisions: sameSession ? result.revisions : [],
    loading: !fresh,
    error: fresh ? result.error : null,
  }
}

// ---------- Reloj y conexión ----------

/** Date.now() que se actualiza cada intervalMs (para cronómetros). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const tick = () => setNow(Date.now())
    const id = setInterval(tick, Math.max(50, intervalMs))
    // Al volver a la pestaña, los temporizadores pueden haber estado frenados
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    const hasDocument = typeof document !== 'undefined'
    if (hasDocument) document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      if (hasDocument) document.removeEventListener('visibilitychange', onVisible)
    }
  }, [intervalMs])
  return now
}

function subscribeOnline(cb: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener('online', cb)
  window.addEventListener('offline', cb)
  return () => {
    window.removeEventListener('online', cb)
    window.removeEventListener('offline', cb)
  }
}

const getOnline = (): boolean => (typeof navigator === 'undefined' ? true : navigator.onLine)

/** navigator.onLine reactivo. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, () => true)
}
