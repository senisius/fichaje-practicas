// Tests de api.ts con Firebase simulado: comprueban el orden de lecturas y las escrituras exactas
// de cada transición (docs/CONTRATO.md). Las reglas se prueban aparte contra el emulador.
// runTransaction reintenta como el SDK real (TransactionRunner): hasta 5 intentos si el error es
// transitorio. `commitFailures` simula fallos del commit, con o sin la escritura aplicada.
import { FirebaseError } from 'firebase/app'
import * as authMod from 'firebase/auth'
import { Timestamp } from 'firebase/firestore'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HOUR_MS, MINUTE_MS, madridDateKey, madridToUtc } from '../lib/time'
import type { AppUser, Session } from '../types'
import * as api from './api'

type Data = Record<string, unknown>

interface CommitFailure {
  /** Código del error que devuelve el commit. */
  code: string
  /** El servidor aplicó la escritura aunque se perdiera la respuesta. */
  applied?: boolean
  /** Cambios de otro dispositivo justo antes de este commit. */
  before?: () => void
}

const h = vi.hoisted(() => {
  const SERVER = { __serverTimestamp: true }
  const db = { __db: true }
  type Op = { op: 'set' | 'update' | 'delete'; path: string; data?: Record<string, unknown> }
  const state = {
    autoId: 0,
    store: new Map<string, Record<string, unknown>>(),
    ops: [] as Op[],
    reads: [] as string[],
    transactions: 0,
    /** Intentos (llamadas a la función de la transacción), sumando reintentos. */
    attempts: 0,
    commitFailures: [] as CommitFailure[],
    /** Como las reglas: un set sobre un documento que ya existe se trata como modificación y se deniega. */
    denyOverwrite: false,
    /** Lecturas denegadas (como la de una sesión inexistente para el student). */
    deniedReads: new Set<string>(),
  }
  const auth = {
    currentUser: { uid: 'stu', email: 'stu@demo.test' } as { uid: string; email: string | null } | null,
    languageCode: null as string | null,
  }
  return { SERVER, db, state, auth }
})

vi.mock('./firebase', () => ({ auth: h.auth, db: h.db }))

vi.mock('firebase/auth', () => ({
  signInWithEmailAndPassword: vi.fn(async () => ({})),
  signOut: vi.fn(async () => {}),
  sendPasswordResetEmail: vi.fn(async () => {}),
  reauthenticateWithCredential: vi.fn(async () => ({})),
  updatePassword: vi.fn(async () => {}),
  EmailAuthProvider: { credential: vi.fn((email: string, password: string) => ({ email, password })) },
}))

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>()
  const { FirebaseError } = await import('firebase/app')
  type Op = { op: 'set' | 'update' | 'delete'; path: string; data?: Record<string, unknown> }
  const apply = (ops: Op[]) => {
    for (const o of ops) {
      if (o.op === 'delete') h.state.store.delete(o.path)
      else if (o.op === 'set') h.state.store.set(o.path, { ...o.data })
      else h.state.store.set(o.path, { ...h.state.store.get(o.path), ...o.data })
    }
  }
  // Mismo criterio que TransactionRunner del SDK
  const retryable = (e: unknown) =>
    e instanceof FirebaseError &&
    ['aborted', 'failed-precondition', 'already-exists', 'cancelled', 'unknown', 'deadline-exceeded',
      'resource-exhausted', 'internal', 'unavailable', 'unauthenticated'].includes(e.code)
  const makeRef = (parent: unknown, segs: string[], kind: 'doc' | 'col') => {
    if (parent === h.db) return { kind, path: segs.join('/'), id: segs[segs.length - 1] }
    const p = parent as { kind: string; path: string }
    if (kind === 'doc' && p.kind === 'col' && segs.length === 0) {
      const id = `auto${++h.state.autoId}`
      return { kind, path: `${p.path}/${id}`, id }
    }
    return { kind, path: `${p.path}/${segs.join('/')}`, id: segs[segs.length - 1] }
  }
  const snapshot = (path: string) => {
    const data = h.state.store.get(path)
    return { exists: () => data !== undefined, data: () => (data === undefined ? undefined : { ...data }) }
  }
  return {
    ...actual,
    doc: vi.fn((parent: unknown, ...segs: string[]) => makeRef(parent, segs, 'doc')),
    collection: vi.fn((parent: unknown, ...segs: string[]) => makeRef(parent, segs, 'col')),
    serverTimestamp: vi.fn(() => h.SERVER),
    getDoc: vi.fn(async (ref: { path: string }) => snapshot(ref.path)),
    runTransaction: vi.fn(async (_db: unknown, fn: (tx: unknown) => Promise<unknown>) => {
      h.state.transactions++
      for (let attemptsLeft = 5; ; attemptsLeft--) {
        h.state.attempts++
        const pending: Op[] = []
        const tx = {
          get: async (ref: { path: string }) => {
            if (pending.length > 0) throw new Error('lectura después de escribir en la transacción')
            h.state.reads.push(ref.path)
            if (h.state.deniedReads.has(ref.path)) throw new FirebaseError('permission-denied', 'lectura denegada')
            return snapshot(ref.path)
          },
          set: (ref: { path: string }, data: Record<string, unknown>) => {
            pending.push({ op: 'set', path: ref.path, data })
            return tx
          },
          update: (ref: { path: string }, data: Record<string, unknown>) => {
            pending.push({ op: 'update', path: ref.path, data })
            return tx
          },
          delete: (ref: { path: string }) => {
            pending.push({ op: 'delete', path: ref.path })
            return tx
          },
        }
        let result: unknown
        try {
          result = await fn(tx)
        } catch (e) {
          if (attemptsLeft > 1 && retryable(e)) continue
          throw e
        }
        if (h.state.denyOverwrite && pending.some((o) => o.op === 'set' && h.state.store.has(o.path))) {
          throw new FirebaseError('permission-denied', 'set sobre un documento existente')
        }
        const failure = h.state.commitFailures.shift()
        if (failure) {
          failure.before?.()
          if (failure.applied) apply(pending)
          const err = new FirebaseError(failure.code, 'fallo simulado del commit')
          if (attemptsLeft > 1 && retryable(err)) continue
          throw err
        }
        if (h.state.denyOverwrite) apply(pending)
        h.state.ops.push(...pending)
        return result
      }
    }),
  }
})

const SESSION_KEYS = [
  'owner',
  'method',
  'start_time',
  'end_time',
  'adjusted',
  'adjust_reason',
  'voided',
  'void_reason',
  'note',
  'rev',
  'created_at',
  'updated_at',
].sort()

function sessionData(over: Data = {}): Data {
  const start = Timestamp.fromMillis(Date.now() - 2 * HOUR_MS)
  return {
    owner: 'stu',
    method: 'live',
    start_time: start,
    end_time: null,
    adjusted: false,
    adjust_reason: '',
    voided: false,
    void_reason: '',
    note: 'nota previa',
    rev: 0,
    created_at: start,
    updated_at: start,
    ...over,
  }
}

function withOpenSession(over: Data = {}): Data {
  const data = sessionData(over)
  h.state.store.set('live/stu', { session_id: 's1' })
  h.state.store.set('sessions/s1', data)
  return data
}

beforeEach(() => {
  h.state.autoId = 0
  h.state.store.clear()
  h.state.ops = []
  h.state.reads = []
  h.state.transactions = 0
  h.state.attempts = 0
  h.state.commitFailures = []
  h.state.denyOverwrite = false
  h.state.deniedReads.clear()
  h.auth.currentUser = { uid: 'stu', email: 'stu@demo.test' }
  vi.clearAllMocks()
})

/** localStorage de mentira (en Node no existe). */
function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('configuración', () => {
  it('pone los correos de Auth en español', () => {
    expect(h.auth.languageCode).toBe('es')
  })
})

describe('startSession', () => {
  it('lee live/{uid} y crea la sesión (12 claves) y el cerrojo', async () => {
    const id = await api.startSession('stu')
    expect(id).toBe('auto1')
    expect(h.state.reads).toEqual(['live/stu'])
    expect(h.state.ops).toHaveLength(2)
    const [session, live] = h.state.ops
    expect(session.op).toBe('set')
    expect(session.path).toBe('sessions/auto1')
    expect(Object.keys(session.data!).sort()).toEqual(SESSION_KEYS)
    expect(session.data).toEqual({
      owner: 'stu',
      method: 'live',
      start_time: h.SERVER,
      end_time: null,
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: '',
      rev: 0,
      created_at: h.SERVER,
      updated_at: h.SERVER,
    })
    expect(live).toEqual({ op: 'set', path: 'live/stu', data: { session_id: 'auto1' } })
  })

  it('guarda una muestra de reloj para estimar el desfase', async () => {
    const id = await api.startSession('stu')
    const sample = api.getClockSample()
    expect(sample?.uid).toBe('stu')
    expect(sample?.sessionId).toBe(id)
    expect(Math.abs(sample!.clientMs - Date.now())).toBeLessThan(5000)
    expect(api.skewFromSample(sample!, sample!.clientMs + 1234)).toBe(1234)
  })

  it('falla si ya hay una sesión en curso, sin escribir', async () => {
    h.state.store.set('live/stu', { session_id: 'otra' })
    h.state.store.set('sessions/otra', { owner: 'stu', method: 'live', end_time: null })
    await expect(api.startSession('stu')).rejects.toThrow('Ya tienes una sesión en curso')
    expect(h.state.reads).toEqual(['live/stu', 'sessions/otra'])
    expect(h.state.ops).toEqual([])
  })

  it('explica el cerrojo huérfano (live apunta a una sesión que ya no existe)', async () => {
    h.state.store.set('live/stu', { session_id: 'borrada' })
    await expect(api.startSession('stu')).rejects.toThrow('queda el cerrojo live/stu de una sesión que ya no existe')
    expect(h.state.ops).toEqual([])
  })

  it('solo con la propia cuenta y con sesión iniciada', async () => {
    await expect(api.startSession('otro')).rejects.toThrow(/propia cuenta/)
    h.auth.currentUser = null
    await expect(api.startSession('stu')).rejects.toThrow(/sesión ha caducado/)
    expect(h.state.transactions).toBe(0)
  })

  it('sin conexión no intenta nada', async () => {
    vi.stubGlobal('navigator', { onLine: false })
    await expect(api.startSession('stu')).rejects.toThrow(/Sin conexión/)
    expect(h.state.transactions).toBe(0)
  })
})

describe('stopSession', () => {
  it('parada normal: revisión exacta, update con las claves permitidas y borrado del cerrojo', async () => {
    const before = withOpenSession()
    await api.stopSession('stu', '  Informe terminado  ')
    expect(h.state.reads).toEqual(['live/stu', 'sessions/s1'])
    expect(h.state.ops).toHaveLength(3)
    const [rev, upd, del] = h.state.ops
    expect(rev).toEqual({ op: 'set', path: 'sessions/s1/revisions/0', data: { before, at: h.SERVER } })
    expect(upd.op).toBe('update')
    expect(upd.path).toBe('sessions/s1')
    expect(upd.data).toEqual({
      end_time: h.SERVER,
      adjusted: false,
      adjust_reason: '',
      note: 'Informe terminado',
      rev: 1,
      updated_at: h.SERVER,
    })
    expect(del).toEqual({ op: 'delete', path: 'live/stu' })
  })

  it('usa String(rev) como id de la revisión', async () => {
    withOpenSession({ rev: 3, note: 'editada' })
    await api.stopSession('stu', '')
    expect(h.state.ops[0].path).toBe('sessions/s1/revisions/3')
    expect(h.state.ops[1].data!.rev).toBe(4)
  })

  it('pasadas 16 h exige indicar la hora real', async () => {
    withOpenSession({ start_time: Timestamp.fromMillis(Date.now() - 16 * HOUR_MS - MINUTE_MS) })
    await expect(api.stopSession('stu', '')).rejects.toThrow(/Han pasado más de 16 h.*a qué hora terminaste/)
    expect(h.state.ops).toEqual([])
  })

  it('parada ajustada: fin tecleado, adjusted y motivo recortado', async () => {
    const start = Date.now() - 20 * HOUR_MS
    withOpenSession({ start_time: Timestamp.fromMillis(start) })
    const end = new Date(start + 8 * HOUR_MS)
    await api.stopSession('stu', 'nota', { end, reason: '  Olvidé parar al salir  ' })
    const upd = h.state.ops[1]
    expect(upd.data).toEqual({
      end_time: Timestamp.fromDate(end),
      adjusted: true,
      adjust_reason: 'Olvidé parar al salir',
      note: 'nota',
      rev: 1,
      updated_at: h.SERVER,
    })
    expect(h.state.ops[2]).toEqual({ op: 'delete', path: 'live/stu' })
  })

  it('parada ajustada no válida: no escribe', async () => {
    const start = Date.now() - 20 * HOUR_MS
    withOpenSession({ start_time: Timestamp.fromMillis(start) })
    await expect(
      api.stopSession('stu', '', { end: new Date(start + 17 * HOUR_MS), reason: 'Olvidé parar al salir' }),
    ).rejects.toThrow(/como máximo 16 h/)
    await expect(
      api.stopSession('stu', '', { end: new Date(Date.now() + MINUTE_MS), reason: 'Olvidé parar al salir' }),
    ).rejects.toThrow(/anterior a este momento/)
    await expect(api.stopSession('stu', '', { end: new Date(start + HOUR_MS), reason: 'corto' })).rejects.toThrow(
      /al menos 10 caracteres/,
    )
    expect(h.state.ops).toEqual([])
  })

  it('sin sesión en curso', async () => {
    await expect(api.stopSession('stu', '')).rejects.toThrow(/No tienes ninguna sesión en curso/)
    expect(h.state.ops).toEqual([])
  })

  it('nota demasiado larga: falla antes de la transacción', async () => {
    withOpenSession()
    await expect(api.stopSession('stu', 'x'.repeat(2001))).rejects.toThrow(/2000 caracteres/)
    expect(h.state.transactions).toBe(0)
  })

  it('funciona sin navigator (Node)', async () => {
    vi.stubGlobal('navigator', undefined)
    withOpenSession()
    await api.stopSession('stu', '')
    expect(h.state.ops).toHaveLength(3)
  })

  it('reintento tras perder la respuesta de un STOP normal que se guardó: termina bien sin escribir más', async () => {
    withOpenSession()
    h.state.commitFailures.push({ code: 'unavailable', applied: true })
    await api.stopSession('stu', ' Informe ')
    expect(h.state.attempts).toBe(2)
    expect(h.state.ops).toEqual([])
    expect(h.state.store.get('sessions/s1')).toMatchObject({ note: 'Informe', adjusted: false, rev: 1 })
    expect(h.state.store.has('live/stu')).toBe(false)
  })

  it('reintento tras perder la respuesta de un STOP ajustado que se guardó: termina bien', async () => {
    const start = Date.now() - 20 * HOUR_MS
    withOpenSession({ start_time: Timestamp.fromMillis(start) })
    h.state.commitFailures.push({ code: 'deadline-exceeded', applied: true })
    const end = new Date(start + 8 * HOUR_MS)
    await api.stopSession('stu', 'Nota', { end, reason: 'Olvidé parar al salir' })
    expect(h.state.attempts).toBe(2)
    expect(h.state.store.get('sessions/s1')).toMatchObject({ adjusted: true, end_time: Timestamp.fromDate(end) })
  })

  it('reintento tras un cierre distinto desde otro dispositivo: error claro, sin escribir', async () => {
    const start = Date.now() - 20 * HOUR_MS
    const before = withOpenSession({ start_time: Timestamp.fromMillis(start) })
    // Mientras este dispositivo reintenta, el móvil para con otra hora y otra nota
    h.state.commitFailures.push({
      code: 'failed-precondition',
      before: () => {
        h.state.store.delete('live/stu')
        h.state.store.set('sessions/s1', {
          ...before,
          end_time: Timestamp.fromMillis(start + 15 * HOUR_MS),
          note: 'Nota del móvil',
          rev: 1,
        })
      },
    })
    await expect(
      api.stopSession('stu', 'Nota del portátil', { end: new Date(start + 8 * HOUR_MS), reason: 'Terminé a las cinco' }),
    ).rejects.toThrow(/ya se había parado desde otro dispositivo \(fin: /)
    expect(h.state.attempts).toBe(2)
    expect(h.state.ops).toEqual([])
    expect(h.state.store.get('sessions/s1')).toMatchObject({ note: 'Nota del móvil', adjusted: false })
  })

  it('reintento con el cerrojo apuntando a una sesión nueva: no la para', async () => {
    const before = withOpenSession()
    h.state.commitFailures.push({
      code: 'aborted',
      before: () => {
        // Otro dispositivo paró s1 (con otra nota) y empezó s2
        h.state.store.set('sessions/s1', { ...before, end_time: Timestamp.now(), note: 'Otra nota', rev: 1 })
        h.state.store.set('sessions/s2', sessionData())
        h.state.store.set('live/stu', { session_id: 's2' })
      },
    })
    await expect(api.stopSession('stu', 'Mi nota')).rejects.toThrow(/ya se había parado desde otro dispositivo/)
    expect(h.state.ops).toEqual([])
    expect(h.state.store.get('sessions/s2')).toMatchObject({ end_time: null })
    expect(h.state.store.get('live/stu')).toEqual({ session_id: 's2' })
  })

  it('reintento sin cambios en el servidor (el commit no llegó): vuelve a intentarlo y para', async () => {
    withOpenSession()
    h.state.commitFailures.push({ code: 'unavailable' })
    await api.stopSession('stu', 'Nota')
    expect(h.state.attempts).toBe(2)
    expect(h.state.ops).toHaveLength(3)
  })

  it('si las reglas rechazan la hora (reloj del dispositivo desajustado) lo explica', async () => {
    withOpenSession()
    h.state.commitFailures.push({ code: 'permission-denied' })
    await expect(api.stopSession('stu', '')).rejects.toThrow(/reloj de este dispositivo.*Terminé antes \/ olvidé parar/)
    const start = Date.now() - 20 * HOUR_MS
    withOpenSession({ start_time: Timestamp.fromMillis(start) })
    h.state.commitFailures.push({ code: 'permission-denied' })
    const err = await api
      .stopSession('stu', '', { end: new Date(start + HOUR_MS), reason: 'Olvidé parar al salir' })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(api.AppError)
    expect((err as Error).message).toMatch(/hora de fin indicada.*reloj de este dispositivo/)
    expect(h.state.transactions).toBe(2)
  })
})

describe('editSessionNote', () => {
  const manual = () =>
    sessionData({
      method: 'manual',
      end_time: Timestamp.fromMillis(Date.now() - HOUR_MS),
      note: 'Nota original',
      rev: 1,
    })

  it('revisión + solo note, rev y updated_at', async () => {
    const before = manual()
    h.state.store.set('sessions/m1', before)
    await api.editSessionNote('m1', '  Nota corregida ')
    expect(h.state.reads).toEqual(['sessions/m1'])
    expect(h.state.ops).toEqual([
      { op: 'set', path: 'sessions/m1/revisions/1', data: { before, at: h.SERVER } },
      { op: 'update', path: 'sessions/m1', data: { note: 'Nota corregida', rev: 2, updated_at: h.SERVER } },
    ])
  })

  it('permite editar la nota de una sesión en curso (live, sin mínimo)', async () => {
    h.state.store.set('sessions/s1', sessionData())
    await api.editSessionNote('s1', '')
    expect(h.state.ops[1].data).toEqual({ note: '', rev: 1, updated_at: h.SERVER })
  })

  it('sin cambios no escribe nada', async () => {
    h.state.store.set('sessions/m1', manual())
    await api.editSessionNote('m1', ' Nota original ')
    expect(h.state.ops).toEqual([])
  })

  it('rechaza anuladas, notas cortas en manuales, ajenas e inexistentes', async () => {
    h.state.store.set('sessions/v', sessionData({ voided: true, void_reason: 'Duplicada por error', end_time: Timestamp.now() }))
    await expect(api.editSessionNote('v', 'Nueva nota')).rejects.toThrow(/anulada/)
    h.state.store.set('sessions/m1', manual())
    await expect(api.editSessionNote('m1', 'abc')).rejects.toThrow(/al menos 5 caracteres/)
    h.state.store.set('sessions/ajena', sessionData({ owner: 'otro' }))
    await expect(api.editSessionNote('ajena', 'Nueva nota')).rejects.toThrow(/tus propias sesiones/)
    await expect(api.editSessionNote('nada', 'Nueva nota')).rejects.toThrow(/no existe/)
    expect(h.state.ops).toEqual([])
  })
})

describe('voidSession', () => {
  it('revisión + voided, void_reason, rev y updated_at', async () => {
    const before = sessionData({ end_time: Timestamp.fromMillis(Date.now() - HOUR_MS), rev: 1 })
    h.state.store.set('sessions/s1', before)
    await api.voidSession('s1', '  Registrada dos veces  ')
    expect(h.state.ops).toEqual([
      { op: 'set', path: 'sessions/s1/revisions/1', data: { before, at: h.SERVER } },
      {
        op: 'update',
        path: 'sessions/s1',
        data: { voided: true, void_reason: 'Registrada dos veces', rev: 2, updated_at: h.SERVER },
      },
    ])
  })

  it('reintento tras perder la respuesta: si ya quedó anulada con este motivo, termina bien', async () => {
    h.state.denyOverwrite = true
    h.state.store.set('sessions/s1', sessionData({ end_time: Timestamp.fromMillis(Date.now() - HOUR_MS), rev: 1 }))
    h.state.commitFailures.push({ code: 'unavailable', applied: true })
    await api.voidSession('s1', ' Registrada dos veces ')
    expect(h.state.attempts).toBe(2)
    expect(h.state.store.get('sessions/s1')).toMatchObject({ voided: true, void_reason: 'Registrada dos veces', rev: 2 })
  })

  it('reintento: si otro dispositivo la anuló con otro motivo, avisa', async () => {
    const before = sessionData({ end_time: Timestamp.fromMillis(Date.now() - HOUR_MS), rev: 1 })
    h.state.store.set('sessions/s1', before)
    h.state.commitFailures.push({
      code: 'failed-precondition',
      before: () => h.state.store.set('sessions/s1', { ...before, voided: true, void_reason: 'Otro motivo largo', rev: 2 }),
    })
    await expect(api.voidSession('s1', 'Registrada dos veces')).rejects.toThrow('Esta sesión ya está anulada.')
  })

  it('rechaza en curso, ya anuladas y motivos cortos', async () => {
    h.state.store.set('sessions/s1', sessionData())
    await expect(api.voidSession('s1', 'Registrada dos veces')).rejects.toThrow(/en curso/)
    h.state.store.set('sessions/v', sessionData({ voided: true, end_time: Timestamp.now() }))
    await expect(api.voidSession('v', 'Registrada dos veces')).rejects.toThrow(/ya está anulada/)
    await expect(api.voidSession('s1', 'corto')).rejects.toThrow(/al menos 10 caracteres/)
    expect(h.state.ops).toEqual([])
  })
})

describe('addManualSession', () => {
  const programStart = Timestamp.fromMillis(Date.now() - 60 * 24 * HOUR_MS)
  const yesterday = () => madridDateKey(Date.now() - 24 * HOUR_MS)

  beforeEach(() => {
    h.state.store.set('users/stu', { role: 'student', name: 'Estudiante', target_hours: 298, program_start: programStart })
  })

  it('crea la sesión manual con las 12 claves y horas de Madrid', async () => {
    const date = yesterday()
    const id = await api.addManualSession('stu', { date, time: '', minutes: 150, note: '  Memoria del proyecto ' })
    expect(id).toBe('auto1')
    expect(h.state.ops).toHaveLength(1)
    const op = h.state.ops[0]
    expect(op.op).toBe('set')
    expect(op.path).toBe('sessions/auto1')
    expect(Object.keys(op.data!).sort()).toEqual(SESSION_KEYS)
    const start = madridToUtc(date, '09:00').getTime()
    expect(op.data).toEqual({
      owner: 'stu',
      method: 'manual',
      start_time: Timestamp.fromMillis(start),
      end_time: Timestamp.fromMillis(start + 150 * MINUTE_MS),
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: 'Memoria del proyecto',
      rev: 0,
      created_at: h.SERVER,
      updated_at: h.SERVER,
    })
  })

  it('respeta la hora indicada', async () => {
    const date = yesterday()
    await api.addManualSession('stu', { date, time: '16:45', minutes: 30, note: 'Reunión de seguimiento' })
    expect(h.state.ops[0].data!.start_time).toEqual(Timestamp.fromDate(madridToUtc(date, '16:45')))
  })

  it('valida antes de escribir', async () => {
    await expect(api.addManualSession('stu', { date: yesterday(), minutes: 30, note: 'abc' })).rejects.toThrow(
      /al menos 5 caracteres/,
    )
    await expect(api.addManualSession('stu', { date: yesterday(), minutes: 961, note: 'Memoria' })).rejects.toThrow(
      /como máximo 16 h/,
    )
    const old = madridDateKey(Date.now() - 40 * 24 * HOUR_MS)
    await expect(api.addManualSession('stu', { date: old, minutes: 30, note: 'Memoria' })).rejects.toThrow(/31 días/)
    expect(h.state.transactions).toBe(0)
  })

  it('reintento tras perder la respuesta: no duplica la entrada ni informa de error', async () => {
    h.state.denyOverwrite = true
    h.state.commitFailures.push({ code: 'unavailable', applied: true })
    const id = await api.addManualSession('stu', { date: yesterday(), minutes: 240, note: 'Memoria del proyecto' })
    expect(id).toBe('auto1')
    expect(h.state.attempts).toBe(2)
    const sessions = [...h.state.store.keys()].filter((k) => k.startsWith('sessions/'))
    expect(sessions).toEqual(['sessions/auto1'])
  })

  it('reintento sin el alta guardada: la lectura denegada cuenta como inexistente y se escribe', async () => {
    h.state.denyOverwrite = true
    // Las reglas deniegan al student leer una sesión que no existe
    h.state.deniedReads.add('sessions/auto1')
    h.state.commitFailures.push({ code: 'unavailable' })
    const id = await api.addManualSession('stu', { date: yesterday(), minutes: 60, note: 'Memoria del proyecto' })
    expect(h.state.attempts).toBe(2)
    expect(h.state.reads).toEqual(['sessions/auto1'])
    expect(h.state.store.get(`sessions/${id}`)).toMatchObject({ method: 'manual', note: 'Memoria del proyecto' })
  })

  it('el primer intento no lee nada (solo escribe)', async () => {
    await api.addManualSession('stu', { date: yesterday(), minutes: 60, note: 'Memoria del proyecto' })
    expect(h.state.reads).toEqual([])
    expect(h.state.attempts).toBe(1)
  })

  it('si las reglas rechazan la entrada (reloj desajustado) lo explica', async () => {
    h.state.commitFailures.push({ code: 'permission-denied' })
    await expect(
      api.addManualSession('stu', { date: yesterday(), minutes: 60, note: 'Memoria del proyecto' }),
    ).rejects.toThrow(/rechazado la entrada.*reloj de este dispositivo/)
  })

  it('exige perfil de student con program_start', async () => {
    h.state.store.set('users/stu', { role: 'student', name: 'Estudiante' })
    await expect(api.addManualSession('stu', { date: yesterday(), minutes: 30, note: 'Memoria' })).rejects.toThrow(
      /program_start/,
    )
    h.state.store.set('users/stu', { role: 'supervisor', name: 'X' })
    await expect(api.addManualSession('stu', { date: yesterday(), minutes: 30, note: 'Memoria' })).rejects.toThrow(
      /estudiante/,
    )
    h.state.store.delete('users/stu')
    await expect(api.addManualSession('stu', { date: yesterday(), minutes: 30, note: 'Memoria' })).rejects.toThrow(
      /estudiante/,
    )
    expect(h.state.ops).toEqual([])
  })
})

describe('addComment', () => {
  const supervisor: AppUser = { uid: 'sup', role: 'supervisor', name: 'Profesora' }
  const session = { id: 's1', ...sessionData() } as unknown as Session

  it('crea el comentario con autora, dueño de la sesión y hora del servidor', async () => {
    h.auth.currentUser = { uid: 'sup', email: 'sup@demo.test' }
    await api.addComment(supervisor, session, '  Revisa la nota \n')
    expect(h.state.ops).toEqual([
      {
        op: 'set',
        path: 'comments/auto1',
        data: { session_id: 's1', session_owner: 'stu', author_uid: 'sup', text: 'Revisa la nota', created_at: h.SERVER },
      },
    ])
  })

  it('reintento tras perder la respuesta: no duplica el comentario', async () => {
    h.auth.currentUser = { uid: 'sup', email: 'sup@demo.test' }
    h.state.denyOverwrite = true
    h.state.commitFailures.push({ code: 'unavailable', applied: true })
    await api.addComment(supervisor, session, 'Revisa la nota')
    expect(h.state.attempts).toBe(2)
    expect([...h.state.store.keys()].filter((k) => k.startsWith('comments/'))).toEqual(['comments/auto1'])
    // Sin la respuesta perdida, también se reintenta y se guarda una sola vez
    h.state.commitFailures.push({ code: 'unavailable' })
    await api.addComment(supervisor, session, 'Otro comentario')
    expect([...h.state.store.keys()].filter((k) => k.startsWith('comments/'))).toEqual(['comments/auto1', 'comments/auto2'])
  })

  it('solo la supervisora y con texto', async () => {
    const student: AppUser = { uid: 'stu', role: 'student', name: 'Estudiante' }
    await expect(api.addComment(student, session, 'Hola')).rejects.toThrow(/supervisora/)
    h.auth.currentUser = { uid: 'sup', email: 'sup@demo.test' }
    await expect(api.addComment(supervisor, session, '   ')).rejects.toThrow(/Escribe un comentario/)
    await expect(api.addComment(supervisor, session, 'x'.repeat(2001))).rejects.toThrow(/2000/)
    expect(h.state.transactions).toBe(0)
  })
})

describe('autenticación', () => {
  it('signIn recorta el email y valida campos vacíos', async () => {
    await api.signIn('  a@b.es ', 'secreto')
    expect(authMod.signInWithEmailAndPassword).toHaveBeenCalledWith(h.auth, 'a@b.es', 'secreto')
    await expect(api.signIn('', 'x')).rejects.toThrow('Escribe tu correo.')
    await expect(api.signIn('a@b.es', '')).rejects.toThrow(/contraseña/)
  })

  it('sendPasswordReset no revela si la cuenta existe', async () => {
    vi.mocked(authMod.sendPasswordResetEmail).mockRejectedValueOnce(new FirebaseError('auth/user-not-found', 'x'))
    await expect(api.sendPasswordReset('nadie@b.es')).resolves.toBeUndefined()
    vi.mocked(authMod.sendPasswordResetEmail).mockRejectedValueOnce(new FirebaseError('auth/invalid-email', 'x'))
    await expect(api.sendPasswordReset('mal')).rejects.toMatchObject({ code: 'auth/invalid-email' })
    await expect(api.sendPasswordReset('  ')).rejects.toThrow('Escribe el correo de tu cuenta.')
    expect(h.auth.languageCode).toBe('es')
  })

  it('changePassword reautentica y cambia', async () => {
    await api.changePassword('actual-123', 'nueva-4567')
    expect(authMod.EmailAuthProvider.credential).toHaveBeenCalledWith('stu@demo.test', 'actual-123')
    expect(authMod.reauthenticateWithCredential).toHaveBeenCalled()
    expect(authMod.updatePassword).toHaveBeenCalledWith(h.auth.currentUser, 'nueva-4567')
  })

  it('changePassword valida y traduce una contraseña actual incorrecta', async () => {
    await expect(api.changePassword('actual-123', 'corta')).rejects.toThrow(/al menos 8/)
    await expect(api.changePassword('misma-1234', 'misma-1234')).rejects.toThrow(/distinta/)
    await expect(api.changePassword('', 'nueva-4567')).rejects.toThrow(/actual/)
    vi.mocked(authMod.reauthenticateWithCredential).mockRejectedValueOnce(
      new FirebaseError('auth/invalid-credential', 'x'),
    )
    await expect(api.changePassword('mala-1234', 'nueva-4567')).rejects.toThrow('La contraseña actual no es correcta.')
    expect(authMod.updatePassword).not.toHaveBeenCalled()
  })

  it('signOutUser borra la muestra de reloj', async () => {
    await api.startSession('stu')
    expect(api.getClockSample()).not.toBeNull()
    await api.signOutUser()
    expect(api.getClockSample()).toBeNull()
    expect(authMod.signOut).toHaveBeenCalled()
  })

  it('signOutUser borra los borradores de notas de este navegador (y solo esos)', async () => {
    const storage = fakeStorage()
    storage.setItem('fichaje-practicas:note:s1', 'Borrador sin guardar')
    storage.setItem('fichaje-practicas:note:s2', 'Otro')
    storage.setItem('otra-app', 'se queda')
    vi.stubGlobal('localStorage', storage)
    await api.signOutUser()
    expect(storage.length).toBe(1)
    expect(storage.getItem('otra-app')).toBe('se queda')
  })

  it('signOutUser funciona aunque el almacenamiento falle', async () => {
    vi.stubGlobal('localStorage', {
      get length(): number {
        throw new Error('bloqueado')
      },
    })
    await expect(api.signOutUser()).resolves.toBeUndefined()
  })
})

describe('friendlyError', () => {
  const firestoreCodes = [
    'permission-denied',
    'unavailable',
    'failed-precondition',
    'aborted',
    'resource-exhausted',
    'deadline-exceeded',
    'not-found',
    'unauthenticated',
  ]
  const authCodes = [
    'auth/invalid-credential',
    'auth/wrong-password',
    'auth/user-not-found',
    'auth/invalid-email',
    'auth/user-disabled',
    'auth/too-many-requests',
    'auth/network-request-failed',
    'auth/weak-password',
    'auth/requires-recent-login',
    'auth/missing-password',
  ]

  it('traduce los códigos conocidos sin mostrarlos', () => {
    const seen = new Set<string>()
    for (const code of [...firestoreCodes, ...authCodes]) {
      const msg = api.friendlyError(new FirebaseError(code, `Firebase: Error (${code}).`))
      expect(msg, code).not.toContain(code)
      expect(msg, code).not.toMatch(/Firebase: |Error \(/)
      expect(msg.length, code).toBeGreaterThan(10)
      seen.add(msg)
    }
    expect(api.friendlyError(new FirebaseError('auth/wrong-password', ''))).toBe('Correo o contraseña incorrectos.')
    expect(api.friendlyError(new FirebaseError('auth/user-not-found', ''))).toBe('Correo o contraseña incorrectos.')
    // Mismo término que el formulario ("Correo electrónico"), nunca "email"
    for (const code of authCodes) {
      expect(api.friendlyError(new FirebaseError(code, '')), code).not.toMatch(/\bemail\b/i)
    }
    expect(api.friendlyError(new FirebaseError('resource-exhausted', ''))).toMatch(/límite diario/)
    expect(api.friendlyError(new FirebaseError('unavailable', ''))).toMatch(/conexión/)
    expect(seen.size).toBeGreaterThan(10)
  })

  it('códigos desconocidos: mensaje genérico sin el código', () => {
    const f = api.friendlyError(new FirebaseError('data-loss-extra', 'raw'))
    expect(f).not.toContain('data-loss-extra')
    const a = api.friendlyError(new FirebaseError('auth/algo-raro', 'raw'))
    expect(a).not.toContain('auth/')
    expect(api.friendlyError({ code: 'EWHATEVER' })).not.toContain('EWHATEVER')
  })

  it('errores propios y de validación se muestran tal cual', () => {
    expect(api.friendlyError(new api.AppError('Ya tienes una sesión en curso'))).toBe('Ya tienes una sesión en curso')
    expect(api.friendlyError(new Error('La fecha "x" no es válida (formato AAAA-MM-DD).'))).toBe(
      'La fecha "x" no es válida (formato AAAA-MM-DD).',
    )
  })

  it('otros errores: red o genérico', () => {
    expect(api.friendlyError(new TypeError('Failed to fetch'))).toMatch(/conexión/)
    expect(api.friendlyError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toMatch(
      /error inesperado/,
    )
    expect(api.friendlyError('texto')).toMatch(/error inesperado/)
    expect(api.friendlyError(null)).toMatch(/error inesperado/)
    expect(api.friendlyError(new Error(''))).toMatch(/error inesperado/)
    vi.stubGlobal('navigator', { onLine: false })
    expect(api.friendlyError(new FirebaseError('internal', 'x'))).toMatch(/conexión/)
  })
})
