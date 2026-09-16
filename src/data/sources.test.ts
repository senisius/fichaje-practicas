// Suscripciones de AppDataProvider con Firestore simulado: consultas, datos de caché antes de la
// primera respuesta del servidor (DATA-4), errores de lectura (UI-9) y revisiones (DATA-3).
import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  failedSources,
  initialData,
  loadRevisions,
  readErrorMessage,
  reducer,
  serverFirst,
  subscribeSources,
  type Action,
  type RawData,
} from './sources'

interface Target {
  kind: string
  path: string
  where?: unknown
}
interface Listener {
  target: Target
  options: unknown
  next: (snap: unknown) => void
  error: (err: unknown) => void
}

const h = vi.hoisted(() => ({
  listeners: [] as Listener[],
  unsubscribed: 0,
  revisions: null as null | ((path: string) => Promise<unknown>),
}))

vi.mock('./firebase', () => ({ db: { __db: true }, auth: {} }))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  return {
    ...actual,
    collection: vi.fn((_parent: unknown, ...segs: string[]) => ({ kind: 'col', path: segs.join('/') })),
    doc: vi.fn((_parent: unknown, ...segs: string[]) => ({ kind: 'doc', path: segs.join('/') })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ field, op, value })),
    query: vi.fn((col: Target, where: unknown) => ({ kind: 'query', path: col.path, where })),
    onSnapshot: vi.fn((target: Target, options: unknown, next: Listener['next'], error: Listener['error']) => {
      h.listeners.push({ target, options, next, error })
      return () => {
        h.unsubscribed++
      }
    }),
    getDocsFromServer: vi.fn((col: Target) => h.revisions!(col.path)),
    getDocs: vi.fn(async () => {
      throw new Error('las revisiones no deben leerse con getDocs (devolvería la caché vacía sin conexión)')
    }),
  }
})

const ts = (iso: string) => Timestamp.fromMillis(Date.parse(iso))

function querySnap(docs: { id: string; data: Record<string, unknown> }[], fromCache: boolean) {
  return {
    metadata: { fromCache, hasPendingWrites: false },
    docs: docs.map((d) => ({ id: d.id, data: () => d.data, metadata: { hasPendingWrites: false } })),
  }
}

function docSnap(data: Record<string, unknown> | null, fromCache: boolean) {
  return { metadata: { fromCache, hasPendingWrites: false }, exists: () => data !== null, data: () => data }
}

function session(id: string, start: string) {
  return {
    id,
    data: {
      owner: 'stu',
      method: 'live',
      start_time: ts(start),
      end_time: null,
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: '',
      rev: 0,
      created_at: ts(start),
      updated_at: ts(start),
    },
  }
}

/** Abre las suscripciones y acumula el estado con el reducer real. */
function open(uid: string, role: 'student' | 'supervisor') {
  let state: RawData = initialData
  const actions: Action[] = []
  const unsubscribe = subscribeSources(uid, role, (a) => {
    actions.push(a)
    state = reducer(state, a)
  })
  const byPath = (path: string) => {
    const l = h.listeners.find((x) => x.target.path === path)
    if (!l) throw new Error(`sin suscripción a ${path}`)
    return l
  }
  return { actions, state: () => state, unsubscribe, byPath }
}

beforeEach(() => {
  h.listeners = []
  h.unsubscribed = 0
  h.revisions = null
})

describe('subscribeSources', () => {
  it('student: cinco suscripciones filtradas por su uid y con metadatos; se cierran todas', () => {
    const s = open('stu', 'student')
    expect(h.listeners.map((l) => l.target)).toEqual([
      { kind: 'query', path: 'sessions', where: { field: 'owner', op: '==', value: 'stu' } },
      { kind: 'doc', path: 'live/stu' },
      { kind: 'query', path: 'comments', where: { field: 'session_owner', op: '==', value: 'stu' } },
      { kind: 'col', path: 'users' },
      { kind: 'doc', path: 'meta/backup' },
    ])
    for (const l of h.listeners) expect(l.options).toEqual({ includeMetadataChanges: true })
    s.unsubscribe()
    expect(h.unsubscribed).toBe(5)
  })

  it('supervisora: colecciones completas', () => {
    open('sup', 'supervisor')
    expect(h.listeners.map((l) => l.target.path)).toEqual(['sessions', 'live', 'comments', 'users', 'meta/backup'])
    expect(h.listeners.every((l) => l.target.kind !== 'query')).toBe(true)
  })

  it('ignora la instantánea vacía de la caché hasta la primera respuesta del servidor', () => {
    const s = open('stu', 'student')
    const sessions = s.byPath('sessions')
    const live = s.byPath('live/stu')
    // Sin conexión, el SDK entrega enseguida datos "de caché" vacíos: no deben darse por cargados
    sessions.next(querySnap([], true))
    live.next(docSnap(null, true))
    expect(s.actions).toEqual([])
    expect(s.state().loaded.sessions).toBe(false)
    expect(s.state().loaded.live).toBe(false)

    // Primera respuesta del servidor
    sessions.next(querySnap([session('b', '2026-09-15T07:00:00Z'), session('a', '2026-09-16T07:00:00Z')], false))
    live.next(docSnap({ session_id: 'a' }, false))
    expect(s.state().loaded.sessions).toBe(true)
    expect(s.state().sessions.map((x) => x.id)).toEqual(['a', 'b'])
    expect(s.state().live.get('stu')).toBe('a')

    // Después, la caché sí es fiable (p. ej. al perder la conexión)
    live.next(docSnap(null, true))
    expect(s.state().live.size).toBe(0)
  })

  it('las cinco fuentes siguen la misma regla', () => {
    const s = open('sup', 'supervisor')
    s.byPath('sessions').next(querySnap([], true))
    s.byPath('live').next(querySnap([], true))
    s.byPath('comments').next(querySnap([], true))
    s.byPath('users').next(querySnap([], true))
    s.byPath('meta/backup').next(docSnap(null, true))
    expect(s.actions).toEqual([])
    s.byPath('sessions').next(querySnap([], false))
    s.byPath('live').next(querySnap([{ id: 'stu', data: { session_id: 'x' } }], false))
    s.byPath('comments').next(querySnap([], false))
    s.byPath('users').next(querySnap([{ id: 'stu', data: { role: 'student', name: 'Marc' } }], false))
    s.byPath('meta/backup').next(docSnap({ last_backup_at: ts('2026-09-14T03:17:00Z'), docs: 3 }, false))
    expect(Object.values(s.state().loaded)).toEqual([true, true, true, true, true])
    expect(s.state().users).toEqual([{ role: 'student', name: 'Marc', uid: 'stu' }])
    expect(s.state().backup?.docs).toBe(3)
  })

  it('descarta documentos mal formados', () => {
    const s = open('stu', 'student')
    const bad = { id: 'mal', data: { owner: 'stu', start_time: '2026-09-16' } }
    s.byPath('sessions').next(querySnap([bad, session('ok', '2026-09-16T07:00:00Z')], false))
    expect(s.state().sessions.map((x) => x.id)).toEqual(['ok'])
  })

  it('un error marca la fuente como fallida con un mensaje de lectura, y se recupera con datos nuevos', () => {
    const s = open('stu', 'student')
    s.byPath('live/stu').error(new FirebaseError('permission-denied', 'x'))
    expect(s.state().loaded.live).toBe(true)
    expect(failedSources(s.state())).toEqual(['live'])
    expect(s.state().errors.live).toMatch(/No tienes permiso para ver estos datos/)
    expect(s.state().errors.live).not.toMatch(/operación/)

    s.byPath('sessions').error(new FirebaseError('unavailable', 'x'))
    expect(failedSources(s.state())).toEqual(['sessions', 'live'])
    expect(s.state().errors.sessions).toMatch(/conexión/)

    s.byPath('sessions').next(querySnap([], false))
    expect(failedSources(s.state())).toEqual(['live'])
  })
})

describe('serverFirst y readErrorMessage', () => {
  it('serverFirst deja pasar todo tras la primera respuesta del servidor', () => {
    const seen: boolean[] = []
    const next = serverFirst((snap: { metadata: { fromCache: boolean } }) => seen.push(snap.metadata.fromCache))
    const snap = (fromCache: boolean) => ({ metadata: { fromCache } }) as never
    next(snap(true))
    next(snap(true))
    next(snap(false))
    next(snap(true))
    expect(seen).toEqual([false, true])
  })

  it('readErrorMessage: permisos de lectura con su propio texto; el resto como friendlyError', () => {
    expect(readErrorMessage(new FirebaseError('permission-denied', 'x'))).toMatch(/ver estos datos/)
    expect(readErrorMessage(new FirebaseError('resource-exhausted', 'x'))).toMatch(/límite diario/)
  })
})

describe('loadRevisions', () => {
  it('lee del servidor y ordena por número', async () => {
    h.revisions = async (path) => {
      expect(path).toBe('sessions/s1/revisions')
      return querySnap(
        [
          { id: '10', data: { before: {}, at: ts('2026-09-16T10:00:00Z') } },
          { id: '2', data: { before: {}, at: ts('2026-09-15T10:00:00Z') } },
          { id: '0', data: { before: {}, at: ts('2026-09-14T10:00:00Z') } },
        ],
        false,
      )
    }
    const revs = await loadRevisions('s1')
    expect(revs.map((r) => r.id)).toEqual(['0', '2', '10'])
  })

  it('sin conexión falla (no devuelve una lista vacía que parezca revisiones perdidas)', async () => {
    h.revisions = async () => {
      throw new FirebaseError('unavailable', 'Failed to get documents from server')
    }
    const err = await loadRevisions('s1').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(FirebaseError)
    expect(readErrorMessage(err)).toMatch(/No se puede conectar con el servidor/)
  })
})
