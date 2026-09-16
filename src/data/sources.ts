// Suscripciones de AppDataProvider y su estado. Van aparte del componente para poder probarlas.
import {
  collection,
  doc,
  getDocsFromServer,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type DocumentSnapshot,
  type FirestoreError,
  type QuerySnapshot,
  type SnapshotListenOptions,
  type SnapshotOptions,
  type Unsubscribe,
} from 'firebase/firestore'
import { compareByStartDesc } from '../lib/time'
import type {
  AppUser,
  BackupMeta,
  Comment,
  CommentDoc,
  LiveDoc,
  Revision,
  RevisionDoc,
  Role,
  Session,
  SessionDoc,
  UserDoc,
} from '../types'
import { errorCode, friendlyError } from './api'
import { db } from './firebase'

export const SNAP: SnapshotOptions = { serverTimestamps: 'estimate' }
// Con metadatos: así se sabe cuándo llega la primera respuesta del servidor
const LISTEN: SnapshotListenOptions = { includeMetadataChanges: true }

export type SourceKey = 'sessions' | 'live' | 'comments' | 'users' | 'backup'
export const SOURCE_KEYS: readonly SourceKey[] = ['sessions', 'live', 'comments', 'users', 'backup']

export interface RawData {
  sessions: Session[]
  /** ids de sesiones cuyo contenido ya confirmó el servidor (sin escrituras pendientes). */
  confirmed: ReadonlySet<string>
  /** uid del student → id de su sesión abierta */
  live: ReadonlyMap<string, string>
  comments: Comment[]
  users: AppUser[]
  backup: BackupMeta | null
  loaded: Readonly<Record<SourceKey, boolean>>
  errors: Readonly<Partial<Record<SourceKey, string>>>
}

export type Action =
  | { type: 'sessions'; sessions: Session[]; confirmed: Set<string> }
  | { type: 'live'; live: Map<string, string> }
  | { type: 'comments'; comments: Comment[] }
  | { type: 'users'; users: AppUser[] }
  | { type: 'backup'; backup: BackupMeta | null }
  | { type: 'error'; key: SourceKey; message: string }

export const initialData: RawData = {
  sessions: [],
  confirmed: new Set(),
  live: new Map(),
  comments: [],
  users: [],
  backup: null,
  loaded: { sessions: false, live: false, comments: false, users: false, backup: false },
  errors: {},
}

function withLoaded(state: RawData, key: SourceKey): Pick<RawData, 'loaded' | 'errors'> {
  const errors = { ...state.errors }
  delete errors[key]
  return { loaded: { ...state.loaded, [key]: true }, errors }
}

export function reducer(state: RawData, action: Action): RawData {
  switch (action.type) {
    case 'sessions':
      return { ...state, sessions: action.sessions, confirmed: action.confirmed, ...withLoaded(state, 'sessions') }
    case 'live':
      return { ...state, live: action.live, ...withLoaded(state, 'live') }
    case 'comments':
      return { ...state, comments: action.comments, ...withLoaded(state, 'comments') }
    case 'users':
      return { ...state, users: action.users, ...withLoaded(state, 'users') }
    case 'backup':
      return { ...state, backup: action.backup, ...withLoaded(state, 'backup') }
    case 'error':
      return {
        ...state,
        loaded: { ...state.loaded, [action.key]: true },
        errors: { ...state.errors, [action.key]: action.message },
      }
  }
}

/** Fuentes que han fallado (sus datos no son fiables: se muestran vacíos). */
export function failedSources(state: RawData): SourceKey[] {
  return SOURCE_KEYS.filter((k) => state.errors[k] !== undefined)
}

/** Mensaje de un error de lectura (los de friendlyError para permission-denied hablan de escrituras). */
export function readErrorMessage(err: unknown): string {
  if (errorCode(err) === 'permission-denied') {
    return 'No tienes permiso para ver estos datos. Recarga la página; si se repite, pide al administrador que revise tu perfil.'
  }
  return friendlyError(err)
}

const hasMillis = (v: unknown): boolean =>
  typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function'

export const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

type Snapshot = QuerySnapshot<DocumentData> | DocumentSnapshot<DocumentData>

/**
 * Envuelve un listener: mientras no haya llegado ninguna respuesta del servidor, se ignoran las
 * instantáneas de la caché. Sin conexión, el SDK entrega enseguida una instantánea vacía "de caché"
 * que la app mostraría como datos reales (0 h, historial vacío, EMPEZAR). Después de la primera
 * respuesta del servidor, la caché sí es fiable y se aceptan todas.
 */
export function serverFirst<T extends Snapshot>(next: (snap: T) => void): (snap: T) => void {
  let synced = false
  return (snap) => {
    if (!synced && snap.metadata.fromCache) return
    synced = true
    next(snap)
  }
}

/** Abre las cinco suscripciones de un usuario. Devuelve la función que las cierra. */
export function subscribeSources(uid: string, role: Role, dispatch: (action: Action) => void): Unsubscribe {
  const unsubs: Unsubscribe[] = []
  const fail = (key: SourceKey) => (err: FirestoreError) => dispatch({ type: 'error', key, message: readErrorMessage(err) })
  const isStudent = role === 'student'
  const sessionsCol = collection(db, 'sessions')
  const commentsCol = collection(db, 'comments')

  unsubs.push(
    onSnapshot(
      isStudent ? query(sessionsCol, where('owner', '==', uid)) : sessionsCol,
      LISTEN,
      serverFirst((snap: QuerySnapshot<DocumentData>) => {
        const sessions: Session[] = []
        const confirmed = new Set<string>()
        for (const d of snap.docs) {
          const data = d.data(SNAP) as SessionDoc
          if (!hasMillis(data.start_time)) continue // documento mal formado: se ignora
          sessions.push({ ...data, id: d.id })
          if (!d.metadata.hasPendingWrites) confirmed.add(d.id)
        }
        sessions.sort(compareByStartDesc)
        dispatch({ type: 'sessions', sessions, confirmed })
      }),
      fail('sessions'),
    ),
  )

  if (isStudent) {
    unsubs.push(
      onSnapshot(
        doc(db, 'live', uid),
        LISTEN,
        serverFirst((snap: DocumentSnapshot<DocumentData>) => {
          const live = new Map<string, string>()
          if (snap.exists()) live.set(uid, (snap.data() as LiveDoc).session_id)
          dispatch({ type: 'live', live })
        }),
        fail('live'),
      ),
    )
  } else {
    unsubs.push(
      onSnapshot(
        collection(db, 'live'),
        LISTEN,
        serverFirst((snap: QuerySnapshot<DocumentData>) => {
          dispatch({ type: 'live', live: new Map(snap.docs.map((d) => [d.id, (d.data() as LiveDoc).session_id])) })
        }),
        fail('live'),
      ),
    )
  }

  unsubs.push(
    onSnapshot(
      isStudent ? query(commentsCol, where('session_owner', '==', uid)) : commentsCol,
      LISTEN,
      serverFirst((snap: QuerySnapshot<DocumentData>) => {
        const comments: Comment[] = []
        for (const d of snap.docs) {
          const data = d.data(SNAP) as CommentDoc
          if (!hasMillis(data.created_at)) continue
          comments.push({ ...data, id: d.id })
        }
        comments.sort((a, b) => a.created_at.toMillis() - b.created_at.toMillis() || byId(a, b))
        dispatch({ type: 'comments', comments })
      }),
      fail('comments'),
    ),
  )

  unsubs.push(
    onSnapshot(
      collection(db, 'users'),
      LISTEN,
      serverFirst((snap: QuerySnapshot<DocumentData>) => {
        const users = snap.docs
          .map((d) => ({ ...(d.data(SNAP) as UserDoc), uid: d.id }))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'es') || (a.uid < b.uid ? -1 : 1))
        dispatch({ type: 'users', users })
      }),
      fail('users'),
    ),
  )

  unsubs.push(
    onSnapshot(
      doc(db, 'meta', 'backup'),
      LISTEN,
      serverFirst((snap: DocumentSnapshot<DocumentData>) => {
        dispatch({ type: 'backup', backup: snap.exists() ? (snap.data(SNAP) as BackupMeta) : null })
      }),
      fail('backup'),
    ),
  )

  return () => {
    for (const unsub of unsubs) unsub()
  }
}

function revisionNumber(id: string): number {
  const n = Number(id)
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER
}

/**
 * Revisiones de una sesión, ordenadas por número. Se leen siempre del servidor: sin conexión, getDocs
 * devolvería la caché vacía y el historial mostraría una falsa alarma de revisiones perdidas.
 */
export async function loadRevisions(sessionId: string): Promise<Revision[]> {
  const snap = await getDocsFromServer(collection(db, 'sessions', sessionId, 'revisions'))
  return snap.docs
    .map((d) => ({ ...(d.data(SNAP) as RevisionDoc), id: d.id }))
    .sort((a, b) => revisionNumber(a.id) - revisionNumber(b.id) || byId(a, b))
}
