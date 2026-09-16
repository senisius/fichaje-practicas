// Estado de autenticación con Firebase simulado: perfil, cuentas sin perfil y reintentos sin conexión (DATA-13).
import { FirebaseError } from 'firebase/app'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { retryDelayMs, subscribeAuthState, UNREACHABLE_AFTER_FAILURES, type AuthState } from './auth-state'

type Profile = { exists: boolean; data?: Record<string, unknown> } | FirebaseError

const h = vi.hoisted(() => ({
  authCallback: null as null | ((user: { uid: string; email: string | null } | null) => void),
  unsubscribed: 0,
  /** Respuestas sucesivas de getDoc(users/uid). */
  profiles: [] as Profile[],
  reads: 0,
}))

vi.mock('./firebase', () => ({ auth: {}, db: {} }))

vi.mock('firebase/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/auth')>()),
  onAuthStateChanged: vi.fn((_auth: unknown, cb: NonNullable<typeof h.authCallback>) => {
    h.authCallback = cb
    return () => {
      h.unsubscribed++
    }
  }),
}))

vi.mock('firebase/firestore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('firebase/firestore')>()),
  doc: vi.fn((_db: unknown, ...segs: string[]) => ({ path: segs.join('/') })),
  getDoc: vi.fn(async () => {
    h.reads++
    const next = h.profiles.shift()
    if (!next) throw new Error('getDoc sin respuesta preparada')
    if (next instanceof FirebaseError) throw next
    return { exists: () => next.exists, data: () => next.data }
  }),
}))

const offline = () => new FirebaseError('unavailable', 'Failed to get document because the client is offline.')
const student = { exists: true, data: { role: 'student', name: 'Estudiante' } }

let states: AuthState[] = []
let stop: () => void = () => {}

beforeEach(() => {
  vi.useFakeTimers()
  h.authCallback = null
  h.unsubscribed = 0
  h.profiles = []
  h.reads = 0
  states = []
  stop = subscribeAuthState((s) => states.push(s))
})

afterEach(() => {
  stop()
  vi.useRealTimers()
})

const signIn = async (uid = 'stu') => {
  h.authCallback!({ uid, email: `${uid}@demo.test` })
  await vi.advanceTimersByTimeAsync(0)
}

describe('subscribeAuthState', () => {
  it('sin sesión → signed-out; con perfil → loading y ready', async () => {
    h.authCallback!(null)
    expect(states).toEqual([{ status: 'signed-out' }])
    h.profiles.push(student)
    await signIn()
    expect(states.slice(1)).toEqual([
      { status: 'loading' },
      { status: 'ready', user: { role: 'student', name: 'Estudiante', uid: 'stu' } },
    ])
  })

  it('sin perfil (lectura denegada, inexistente o rol desconocido) → no-profile', async () => {
    h.profiles.push(new FirebaseError('permission-denied', 'x'))
    await signIn('a')
    expect(states.at(-1)).toEqual({ status: 'no-profile', uid: 'a', email: 'a@demo.test' })
    h.profiles.push({ exists: false })
    await signIn('b')
    expect(states.at(-1)).toMatchObject({ status: 'no-profile', uid: 'b' })
    h.profiles.push({ exists: true, data: { role: 'admin', name: 'X' } })
    await signIn('c')
    expect(states.at(-1)).toMatchObject({ status: 'no-profile', uid: 'c' })
  })

  it('sin conexión: reintenta y, tras varios fallos, avisa de que no llega al servidor', async () => {
    h.profiles.push(offline(), offline(), offline(), student)
    await signIn()
    expect(states).toEqual([{ status: 'loading' }])
    expect(UNREACHABLE_AFTER_FAILURES).toBe(2)

    await vi.advanceTimersByTimeAsync(retryDelayMs(0))
    expect(h.reads).toBe(2)
    expect(states).toEqual([{ status: 'loading' }, { status: 'loading', unreachable: true }])

    // El aviso no se repite en cada fallo
    await vi.advanceTimersByTimeAsync(retryDelayMs(1))
    expect(h.reads).toBe(3)
    expect(states).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(retryDelayMs(2))
    expect(h.reads).toBe(4)
    expect(states.at(-1)).toMatchObject({ status: 'ready' })
  })

  it('reintenta en cuanto vuelve la conexión, sin esperar al temporizador', async () => {
    const listeners = new Map<string, () => void>()
    vi.stubGlobal('window', {
      addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
      removeEventListener: (type: string) => listeners.delete(type),
    })
    try {
      h.profiles.push(offline(), student)
      await signIn()
      expect(h.reads).toBe(1)
      listeners.get('online')!()
      await vi.advanceTimersByTimeAsync(0)
      expect(h.reads).toBe(2)
      expect(states.at(-1)).toMatchObject({ status: 'ready' })
      expect(listeners.has('online')).toBe(false)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('las respuestas de un usuario anterior se ignoran y al cerrar no quedan reintentos', async () => {
    h.profiles.push(offline())
    await signIn('viejo')
    h.authCallback!(null)
    expect(states.at(-1)).toEqual({ status: 'signed-out' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.reads).toBe(1)
    stop()
    expect(h.unsubscribed).toBe(1)
  })

  it('retryDelayMs crece hasta 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 10].map(retryDelayMs)).toEqual([1000, 2000, 4000, 8000, 16_000, 30_000, 30_000])
  })
})
