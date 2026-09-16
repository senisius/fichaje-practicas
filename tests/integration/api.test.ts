// Integración real: src/data/api.ts y src/data/firebase.ts contra los emuladores con las reglas
// reales (npm run test:integration). Los casos van en orden y comparten estado: cada bloque parte
// de lo que dejó el anterior.
import { deleteApp } from 'firebase/app'
import {
  DocumentReference,
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel,
  terminate,
  updateDoc,
  where,
  type DocumentData,
  type Query,
  type Transaction,
} from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addComment,
  addManualSession,
  editSessionNote,
  existsInTransaction,
  friendlyError,
  setServerSkewMs,
  signIn,
  signOutUser,
  startSession,
  stopSession,
  voidSession,
} from '../../src/data/api'
import { app, auth, db, firebaseConfigured, USE_EMULATORS } from '../../src/data/firebase'
import {
  failedSources,
  initialData,
  loadRevisions,
  reducer,
  SOURCE_KEYS,
  subscribeSources,
  type RawData,
} from '../../src/data/sources'
import { addDaysKey, madridDateKey, madridTimeKey, madridToUtc } from '../../src/lib/time'
import type { AppUser, LiveDoc, Session, SessionDoc } from '../../src/types'
import {
  ACCOUNTS,
  DAY,
  HOUR,
  MINUTE,
  SESSION_KEYS,
  adminDb,
  ats,
  closeAdmin,
  countDocs,
  expectAppError,
  expectDenied,
  expectServerTime,
  readDoc,
  readRevisions,
  resetEmulators,
  sameInstant,
  seedAccounts,
  seedOpenSession,
  sleep,
  sortedKeys,
  type Account,
} from './helpers'

// Los casos negativos provocan denegaciones a propósito: sin esto el SDK llena la salida de avisos.
setLogLevel('error')

const STUDENT = ACCOUNTS.student.uid
const SUPERVISOR = ACCOUNTS.supervisor.uid
const PROGRAM_START_MS = Date.now() - 60 * DAY

async function loginAs(a: Account): Promise<void> {
  if (auth.currentUser) await signOutUser()
  await signIn(a.email, a.password)
  expect(auth.currentUser?.uid).toBe(a.uid)
}

/** Espera el primer resultado (o error) de un onSnapshot, como hace AppDataProvider. */
function firstSnapshot(target: Query | DocumentReference): Promise<void> {
  return new Promise((resolve, reject) => {
    const handlers = {
      next: () => {
        unsub()
        resolve()
      },
      error: (e: unknown) => {
        unsub()
        reject(e)
      },
    }
    const unsub =
      target instanceof DocumentReference ? onSnapshot(target, handlers) : onSnapshot(target, handlers)
  })
}

/** Abre las suscripciones reales de AppDataProvider y espera a que todas respondan. */
async function loadSources(uid: string, role: 'student' | 'supervisor'): Promise<RawData> {
  let state: RawData = initialData
  const unsubscribe = subscribeSources(uid, role, (a) => {
    state = reducer(state, a)
  })
  try {
    for (let i = 0; i < 100 && !SOURCE_KEYS.every((k) => state.loaded[k]); i++) await sleep(100)
    expect(state.loaded).toEqual({ sessions: true, live: true, comments: true, users: true, backup: true })
    return state
  } finally {
    unsubscribe()
  }
}

/** Ejecuta `fn` dentro de una transacción y la aborta (sin commit), devolviendo su resultado. */
async function inAbortedTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  const ABORT = new Error('abortar')
  let result: T | undefined
  await runTransaction(db, async (tx) => {
    result = await fn(tx)
    throw ABORT
  }).catch((e: unknown) => {
    if (e !== ABORT) throw e
  })
  return result as T
}

/** STOP tal cual lo describe PROPUESTA §5, sin las comprobaciones del cliente (para probar las reglas). */
async function rawStop(uid: string, end: Timestamp | null, reason = ''): Promise<void> {
  await runTransaction(db, async (tx) => {
    const liveRef = doc(db, 'live', uid)
    const live = await tx.get(liveRef)
    const sRef = doc(db, 'sessions', (live.data() as LiveDoc).session_id)
    const cur = (await tx.get(sRef)).data() as SessionDoc
    tx.set(doc(sRef, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() })
    tx.update(sRef, {
      end_time: end ?? serverTimestamp(),
      adjusted: end !== null,
      adjust_reason: reason,
      note: '',
      rev: cur.rev + 1,
      updated_at: serverTimestamp(),
    })
    tx.delete(liveRef)
  })
}

/** Alta manual escrita directamente (sin validación del cliente). */
async function rawManual(uid: string, startMs: number, minutes: number, note: string): Promise<void> {
  const ref = doc(collection(db, 'sessions'))
  await runTransaction(db, async (tx) => {
    tx.set(ref, {
      owner: uid,
      method: 'manual',
      start_time: Timestamp.fromMillis(startMs),
      end_time: Timestamp.fromMillis(startMs + minutes * MINUTE),
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note,
      rev: 0,
      created_at: serverTimestamp(),
      updated_at: serverTimestamp(),
    })
  })
}

/** Comprueba la revisión `id` (estado anterior exacto) y que su `at` es el updated_at del cambio. */
async function expectRevision(sessionId: string, id: string, before: DocumentData | undefined): Promise<void> {
  const revs = await readRevisions(sessionId)
  const rev = revs.get(id)
  expect(rev, `revisión ${id}`).toBeDefined()
  expect(sortedKeys(rev)).toEqual(['at', 'before'])
  expect(rev!.before).toEqual(before)
  const after = await readDoc(`sessions/${sessionId}`)
  expect(sameInstant(rev!.at, after!.updated_at)).toBe(true)
  expect(revs.size).toBe(after!.rev)
}

beforeAll(async () => {
  expect(USE_EMULATORS).toBe(true)
  expect(firebaseConfigured).toBe(true)
  await resetEmulators()
  await seedAccounts(PROGRAM_START_MS)
})

afterAll(async () => {
  if (auth.currentUser) await signOutUser()
  await terminate(db)
  await deleteApp(app)
  await closeAdmin()
})

describe('student: fichaje en vivo', () => {
  let firstId = ''

  it('START crea la sesión con la hora del servidor y el cerrojo live', async () => {
    await loginAs(ACCOUNTS.student)
    const t0 = Date.now()
    firstId = await startSession(STUDENT)
    const t1 = Date.now()

    const s = await readDoc(`sessions/${firstId}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({
      owner: STUDENT,
      method: 'live',
      end_time: null,
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: '',
      rev: 0,
    })
    expectServerTime(s!.start_time, t0, t1)
    expect(sameInstant(s!.start_time, s!.created_at)).toBe(true)
    expect(sameInstant(s!.start_time, s!.updated_at)).toBe(true)
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: firstId })
    expect((await readRevisions(firstId)).size).toBe(0)
  })

  it('un segundo START da un error claro y no crea nada', async () => {
    const before = await countDocs('sessions')
    await expectAppError(startSession(STUDENT), /Ya tienes una sesión en curso/)
    expect(await countDocs('sessions')).toBe(before)
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: firstId })
  })

  it('las reglas también impiden un segundo cerrojo aunque se salte el cliente', async () => {
    const ref = doc(collection(db, 'sessions'))
    await expectDenied(
      runTransaction(db, async (tx) => {
        tx.set(ref, {
          owner: STUDENT,
          method: 'live',
          start_time: serverTimestamp(),
          end_time: null,
          adjusted: false,
          adjust_reason: '',
          voided: false,
          void_reason: '',
          note: '',
          rev: 0,
          created_at: serverTimestamp(),
          updated_at: serverTimestamp(),
        })
        tx.set(doc(db, 'live', STUDENT), { session_id: ref.id })
      }),
    )
    expect(await readDoc(`sessions/${ref.id}`)).toBeUndefined()
  })

  it('editar la nota con la sesión en curso guarda la revisión 0', async () => {
    const before = await readDoc(`sessions/${firstId}`)
    const t0 = Date.now()
    await editSessionNote(firstId, '  Revisión de expedientes  ')
    const t1 = Date.now()

    const s = await readDoc(`sessions/${firstId}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({ note: 'Revisión de expedientes', rev: 1, end_time: null })
    expectServerTime(s!.updated_at, t0, t1)
    expect(sameInstant(s!.start_time, before!.start_time)).toBe(true)
    await expectRevision(firstId, '0', before)
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: firstId })

    // Misma nota: no escribe nada (rev no sube)
    await editSessionNote(firstId, 'Revisión de expedientes')
    expect((await readDoc(`sessions/${firstId}`))!.rev).toBe(1)
  })

  it('STOP normal cierra con la hora del servidor, guarda la revisión y borra el cerrojo', async () => {
    const before = await readDoc(`sessions/${firstId}`)
    const t0 = Date.now()
    await stopSession(STUDENT, '  Revisión de expedientes y archivo  ')
    const t1 = Date.now()

    const s = await readDoc(`sessions/${firstId}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({
      method: 'live',
      adjusted: false,
      adjust_reason: '',
      voided: false,
      note: 'Revisión de expedientes y archivo',
      rev: 2,
    })
    expectServerTime(s!.end_time, t0, t1)
    expect(sameInstant(s!.end_time, s!.updated_at)).toBe(true)
    expect(sameInstant(s!.start_time, before!.start_time)).toBe(true)
    expect(sameInstant(s!.created_at, before!.created_at)).toBe(true)
    await expectRevision(firstId, '1', before)
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('parar sin sesión en curso da un error claro', async () => {
    await expectAppError(stopSession(STUDENT, ''), /No tienes ninguna sesión en curso/)
  })

  it('editar la nota de una sesión cerrada guarda la revisión 2', async () => {
    const before = await readDoc(`sessions/${firstId}`)
    await editSessionNote(firstId, 'Revisión de expedientes, archivo y actas')
    const s = await readDoc(`sessions/${firstId}`)
    expect(s).toMatchObject({ note: 'Revisión de expedientes, archivo y actas', rev: 3 })
    expect(sameInstant(s!.end_time, before!.end_time)).toBe(true)
    await expectRevision(firstId, '2', before)
  })

  it('START + STOP ajustado: valida en el cliente y guarda el fin tecleado', async () => {
    const id = await startSession(STUDENT)
    const open = await readDoc(`sessions/${id}`)
    const startMs = (open!.start_time as Timestamp).toMillis()
    const reason = 'Terminé antes y olvidé parar el fichaje'

    // Fin 30 min antes de ahora: anterior al inicio de esta sesión recién empezada
    await expectAppError(
      stopSession(STUDENT, '', { end: new Date(Date.now() - 30 * MINUTE), reason }),
      /tiene que ser posterior al inicio/,
    )
    // Fin en el futuro
    await expectAppError(
      stopSession(STUDENT, '', { end: new Date(Date.now() + 10 * MINUTE), reason }),
      /tiene que ser anterior a este momento/,
    )
    // Motivo demasiado corto
    await expectAppError(
      stopSession(STUDENT, '', { end: new Date(startMs + 500), reason: '  corto  ' }),
      /El motivo del ajuste debe tener al menos 10 caracteres/,
    )
    // Nada ha cambiado
    expect((await readDoc(`sessions/${id}`))!.rev).toBe(0)
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: id })

    await sleep(1500)
    const end = new Date(startMs + 1000)
    await stopSession(STUDENT, 'Reunión breve', { end, reason: `  ${reason}  ` })

    const s = await readDoc(`sessions/${id}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({ adjusted: true, adjust_reason: reason, note: 'Reunión breve', rev: 1 })
    expect(sameInstant(s!.end_time, ats(end.getTime()))).toBe(true)
    await expectRevision(id, '0', open)
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('un cerrojo huérfano (sesión borrada desde la consola) da un mensaje claro', async () => {
    await adminDb().doc(`live/${STUDENT}`).set({ session_id: 'borrada-en-consola' })
    try {
      await expectAppError(startSession(STUDENT), /queda el cerrojo live\/uid-estudiante de una sesión que ya no existe/)
      // Las reglas no dejan al estudiante borrarlo: solo se arregla desde la consola
      await expectDenied(deleteDoc(doc(db, 'live', STUDENT)))
    } finally {
      await adminDb().doc(`live/${STUDENT}`).delete()
    }
  })

  it('sesión abierta hace 2 h: STOP ajustado con fin 30 min antes de ahora', async () => {
    const startMs = Date.now() - 2 * HOUR
    const id = await seedOpenSession(STUDENT, startMs)
    const open = await readDoc(`sessions/${id}`)
    const end = new Date(Date.now() - 30 * MINUTE)
    await stopSession(STUDENT, 'Preparación del taller', { end, reason: 'Salí a las once y olvidé parar' })

    const s = await readDoc(`sessions/${id}`)
    expect(s).toMatchObject({ adjusted: true, adjust_reason: 'Salí a las once y olvidé parar', rev: 1 })
    expect(sameInstant(s!.end_time, ats(end.getTime()))).toBe(true)
    await expectRevision(id, '0', open)
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('sesión abierta hace 17 h: STOP normal falla con un mensaje claro y el ajustado funciona', async () => {
    const startMs = Date.now() - 17 * HOUR
    const id = await seedOpenSession(STUDENT, startMs)
    const open = await readDoc(`sessions/${id}`)

    await expectAppError(stopSession(STUDENT, 'Nota'), /más de 16 h desde que empezaste.*Terminé antes \/ olvidé parar/)
    // Las reglas lo rechazan igualmente si se salta el cliente
    await expectDenied(rawStop(STUDENT, null))
    // Fin ajustado a más de 16 h del inicio
    await expectAppError(
      stopSession(STUDENT, '', { end: new Date(startMs + 16 * HOUR + MINUTE), reason: 'Olvidé parar ayer por la tarde' }),
      /como máximo 16 h/,
    )
    expect(await readDoc(`sessions/${id}`)).toEqual(open)
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: id })

    const end = new Date(startMs + 8 * HOUR)
    await stopSession(STUDENT, '  Jornada completa  ', { end, reason: 'Olvidé parar ayer al salir a las 17:00' })
    const s = await readDoc(`sessions/${id}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({
      adjusted: true,
      adjust_reason: 'Olvidé parar ayer al salir a las 17:00',
      note: 'Jornada completa',
      rev: 1,
      voided: false,
    })
    expect(sameInstant(s!.end_time, ats(end.getTime()))).toBe(true)
    await expectRevision(id, '0', open)
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })
})

describe('student: reloj del dispositivo desajustado', () => {
  it('STOP normal con el reloj atrasado pasadas 16 h: el servidor lo rechaza y el mensaje lo explica', async () => {
    await loginAs(ACCOUNTS.student)
    const startMs = Date.now() - 16 * HOUR - 2 * MINUTE
    const id = await seedOpenSession(STUDENT, startMs)
    // Este dispositivo cree que es 5 min antes: para él aún no han pasado 16 h
    setServerSkewMs(-5 * MINUTE)
    try {
      await expectAppError(stopSession(STUDENT, 'Nota'), /reloj de este dispositivo.*Terminé antes \/ olvidé parar/)
    } finally {
      setServerSkewMs(0)
    }
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: id })
    expect((await readDoc(`sessions/${id}`))!.rev).toBe(0)
    await stopSession(STUDENT, '', { end: new Date(startMs + 8 * HOUR), reason: 'Olvidé parar al salir de la oficina' })
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('STOP ajustado con el reloj adelantado (fin en el futuro del servidor): mensaje claro', async () => {
    const startMs = Date.now() - HOUR
    const id = await seedOpenSession(STUDENT, startMs)
    setServerSkewMs(10 * MINUTE)
    try {
      await expectAppError(
        stopSession(STUDENT, '', { end: new Date(Date.now() + 5 * MINUTE), reason: 'Terminé hace un momento' }),
        /hora de fin indicada.*reloj de este dispositivo/,
      )
    } finally {
      setServerSkewMs(0)
    }
    expect((await readDoc(`sessions/${id}`))!.rev).toBe(0)
    await stopSession(STUDENT, '')
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('entrada manual con el reloj adelantado (termina en el futuro del servidor): mensaje claro y nada guardado', async () => {
    const before = await countDocs('sessions')
    const start = Date.now() - 50 * MINUTE
    setServerSkewMs(15 * MINUTE)
    try {
      await expectAppError(
        addManualSession(STUDENT, { date: madridDateKey(start), time: madridTimeKey(start), minutes: 60, note: 'Reloj adelantado' }),
        /rechazado la entrada.*reloj de este dispositivo/,
      )
    } finally {
      setServerSkewMs(0)
    }
    expect(await countDocs('sessions')).toBe(before)
  })
})

describe('student: entradas manuales, notas y anulaciones', () => {
  let manualId = ''
  const today = madridDateKey(Date.now())

  it('alta manual válida (hora de Madrid, servidor pone created_at)', async () => {
    await loginAs(ACCOUNTS.student)
    const date = addDaysKey(today, -2)
    const t0 = Date.now()
    manualId = await addManualSession(STUDENT, { date, time: '10:15', minutes: 90, note: '  Formación en línea  ' })
    const t1 = Date.now()

    const s = await readDoc(`sessions/${manualId}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    const start = madridToUtc(date, '10:15').getTime()
    expect(s).toMatchObject({
      owner: STUDENT,
      method: 'manual',
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: 'Formación en línea',
      rev: 0,
    })
    expect(sameInstant(s!.start_time, ats(start))).toBe(true)
    expect(sameInstant(s!.end_time, ats(start + 90 * MINUTE))).toBe(true)
    expectServerTime(s!.created_at, t0, t1)
    expect(sameInstant(s!.created_at, s!.updated_at)).toBe(true)
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })

  it('sin hora usa las 09:00 de Madrid y admite una nota de 5 emojis', async () => {
    const date = addDaysKey(today, -3)
    const id = await addManualSession(STUDENT, { date, minutes: 30, note: '📚📚📚📚📚' })
    const s = await readDoc(`sessions/${id}`)
    expect(sameInstant(s!.start_time, ats(madridToUtc(date, '09:00').getTime()))).toBe(true)
    expect(s!.note).toBe('📚📚📚📚📚')
  })

  it('las manuales inválidas se rechazan en el cliente con un mensaje claro y no se guardan', async () => {
    const before = await countDocs('sessions')
    const past = addDaysKey(today, -2)

    await expectAppError(
      addManualSession(STUDENT, { date: addDaysKey(today, 1), time: '09:00', minutes: 60, note: 'Mañana' }),
      /No puedes registrar horas en el futuro/,
    )
    await expectAppError(
      addManualSession(STUDENT, { date: past, time: '06:00', minutes: 16 * 60 + 1, note: 'Muy larga' }),
      /como máximo 16 h/,
    )
    await expectAppError(
      addManualSession(STUDENT, { date: addDaysKey(today, -40), minutes: 60, note: 'Muy antigua' }),
      /Solo puedes registrar horas de los últimos 31 días/,
    )
    await expectAppError(
      addManualSession(STUDENT, { date: past, minutes: 60, note: ' abc ' }),
      /La nota \(qué has hecho\) debe tener al menos 5 caracteres/,
    )
    await expectAppError(
      addManualSession(STUDENT, { date: past, minutes: 60, note: '📚📚📚📚' }),
      /al menos 5 caracteres \(ahora tiene 4\)/,
    )
    await expectAppError(
      addManualSession(STUDENT, { date: past, minutes: 60, note: 'x'.repeat(2001) }),
      /como máximo 2000 caracteres/,
    )
    await expectAppError(addManualSession(STUDENT, { date: '2026-02-30', minutes: 60, note: 'Fecha rara' }), /no es válida/)
    await expectAppError(addManualSession(STUDENT, { date: past, minutes: 0, note: 'Sin duración' }), /mayor que 0/)
    await expectAppError(
      addManualSession(STUDENT, { date: past, time: '25:00', minutes: 60, note: 'Hora rara' }),
      /La hora "25:00" no es válida/,
    )

    // Antes de program_start (se acerca temporalmente a hace 5 días)
    const userRef = adminDb().doc(`users/${STUDENT}`)
    await userRef.update({ program_start: ats(Date.now() - 5 * DAY) })
    try {
      await expectAppError(
        addManualSession(STUDENT, { date: addDaysKey(today, -10), minutes: 60, note: 'Antes de empezar' }),
        /antes del inicio de las prácticas/,
      )
      await expectDenied(rawManual(STUDENT, Date.now() - 10 * DAY, 60, 'Antes de empezar'))
    } finally {
      await userRef.update({ program_start: ats(PROGRAM_START_MS) })
    }

    expect(await countDocs('sessions')).toBe(before)
  })

  it('las reglas rechazan lo mismo si se salta el cliente', async () => {
    const before = await countDocs('sessions')
    const pastStart = Date.now() - 2 * DAY
    await expectDenied(rawManual(STUDENT, Date.now() - MINUTE, 60, 'Termina en el futuro'))
    await expectDenied(rawManual(STUDENT, pastStart, 16 * 60 + 1, 'Demasiado larga'))
    await expectDenied(rawManual(STUDENT, Date.now() - 32 * DAY, 60, 'Demasiado antigua'))
    await expectDenied(rawManual(STUDENT, pastStart, 60, 'abc'))
    await expectDenied(rawManual(STUDENT, pastStart, 60, '   abcd   '))
    await expectDenied(rawManual(STUDENT, pastStart, 60, 'abcd\x01'))
    expect(await countDocs('sessions')).toBe(before)
  })

  it('reintentos: una lectura denegada dentro de la transacción cuenta como inexistente y no impide escribir', async () => {
    const ref = doc(collection(db, 'sessions'))
    const startMs = Date.now() - 3 * DAY
    await runTransaction(db, async (tx) => {
      expect(await existsInTransaction(tx, ref)).toBe(false)
      tx.set(ref, {
        owner: STUDENT,
        method: 'manual',
        start_time: Timestamp.fromMillis(startMs),
        end_time: Timestamp.fromMillis(startMs + 45 * MINUTE),
        adjusted: false,
        adjust_reason: '',
        voided: false,
        void_reason: '',
        note: 'Alta tras un reintento',
        rev: 0,
        created_at: serverTimestamp(),
        updated_at: serverTimestamp(),
      })
    })
    expect(await readDoc(`sessions/${ref.id}`)).toMatchObject({ method: 'manual', note: 'Alta tras un reintento' })
    // En el siguiente reintento ya existe: se detecta sin escribir nada
    expect(await inAbortedTransaction((tx) => existsInTransaction(tx, ref))).toBe(true)
    expect((await readDoc(`sessions/${ref.id}`))!.rev).toBe(0)
  })

  it('textos con emojis: el cliente nunca acepta lo que las reglas rechazan', async () => {
    // size() cuenta unidades UTF-16: 1001 emojis ocupan 2002 y superan el máximo de 2000
    const before = await countDocs('sessions')
    const pastStart = Date.now() - 4 * DAY
    const date = madridDateKey(pastStart)
    await expectDenied(rawManual(STUDENT, pastStart, 60, '📚'.repeat(1001)))
    await expectAppError(
      addManualSession(STUDENT, { date, minutes: 60, note: '📚'.repeat(1001) }),
      /como máximo 2000 caracteres \(ahora ocupa 2002/,
    )
    await expectAppError(editSessionNote(manualId, '📚'.repeat(1001)), /como máximo 2000 caracteres/)
    await expectAppError(addManualSession(STUDENT, { date, minutes: 60, note: 'abcd\x01' }), /al menos 5 caracteres/)
    expect(await countDocs('sessions')).toBe(before)
    // En el límite: 1000 emojis (2000 unidades) valen en el cliente y en las reglas
    const id = await addManualSession(STUDENT, { date, time: '08:00', minutes: 30, note: '📚'.repeat(1000) })
    expect((await readDoc(`sessions/${id}`))!.note).toBe('📚'.repeat(1000))
  })

  it('editar la nota de una manual: revisión 0 y mínimo de 5 caracteres', async () => {
    const before = await readDoc(`sessions/${manualId}`)
    await expectAppError(editSessionNote(manualId, 'abc'), /al menos 5 caracteres/)
    expect(await readDoc(`sessions/${manualId}`)).toEqual(before)

    await editSessionNote(manualId, 'Formación en línea: protección de datos')
    const s = await readDoc(`sessions/${manualId}`)
    expect(s).toMatchObject({ note: 'Formación en línea: protección de datos', rev: 1 })
    expect(sameInstant(s!.start_time, before!.start_time)).toBe(true)
    expect(sameInstant(s!.end_time, before!.end_time)).toBe(true)
    await expectRevision(manualId, '0', before)
  })

  it('anular exige motivo, no vale para sesiones en curso y guarda la revisión', async () => {
    await expectAppError(voidSession(manualId, 'corto'), /El motivo de la anulación debe tener al menos 10 caracteres/)

    const openId = await startSession(STUDENT)
    await expectAppError(voidSession(openId, 'Motivo suficientemente largo'), /No se puede anular una sesión en curso/)
    await stopSession(STUDENT, '')
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()

    const before = await readDoc(`sessions/${manualId}`)
    const t0 = Date.now()
    await voidSession(manualId, '  Duración equivocada; la registro de nuevo  ')
    const t1 = Date.now()
    const s = await readDoc(`sessions/${manualId}`)
    expect(sortedKeys(s)).toEqual(SESSION_KEYS)
    expect(s).toMatchObject({
      voided: true,
      void_reason: 'Duración equivocada; la registro de nuevo',
      note: before!.note,
      rev: 2,
    })
    expectServerTime(s!.updated_at, t0, t1)
    expect(sameInstant(s!.start_time, before!.start_time)).toBe(true)
    expect(sameInstant(s!.end_time, before!.end_time)).toBe(true)
    await expectRevision(manualId, '1', before)
  })

  it('anular dos veces o editar una anulada da un error claro', async () => {
    const before = await readDoc(`sessions/${manualId}`)
    await expectAppError(voidSession(manualId, 'Otro motivo bastante largo'), /Esta sesión ya está anulada/)
    await expectAppError(editSessionNote(manualId, 'Nota nueva'), /No se puede editar la nota de una sesión anulada/)
    expect(await readDoc(`sessions/${manualId}`)).toEqual(before)
    expect((await readRevisions(manualId)).size).toBe(2)
  })

  it('una sesión inexistente se rechaza sin escribir nada', async () => {
    await expectDenied(voidSession('no-existe', 'Motivo suficientemente largo'))
    await expectDenied(editSessionNote('no-existe', 'Nota'))
    expect(await readDoc('sessions/no-existe')).toBeUndefined()
  })

  it('addComment desde la cuenta del student se rechaza', async () => {
    const s = await readDoc(`sessions/${manualId}`)
    const student: AppUser = { uid: STUDENT, role: 'student', name: 'Estudiante Demo' }
    const session = { ...(s as SessionDoc), id: manualId } as Session
    await expectAppError(addComment(student, session, 'Hola'), /Solo la supervisora/)
    await expectDenied(
      setDoc(doc(collection(db, 'comments')), {
        session_id: manualId,
        session_owner: STUDENT,
        author_uid: STUDENT,
        text: 'Hola',
        created_at: serverTimestamp(),
      }),
    )
  })

  it('las lecturas de AppDataProvider están permitidas para el student', async () => {
    await firstSnapshot(query(collection(db, 'sessions'), where('owner', '==', STUDENT)))
    await firstSnapshot(doc(db, 'live', STUDENT))
    await firstSnapshot(query(collection(db, 'comments'), where('session_owner', '==', STUDENT)))
    await firstSnapshot(collection(db, 'users'))
    await firstSnapshot(doc(db, 'meta', 'backup'))
    const revs = await getDocs(collection(db, 'sessions', manualId, 'revisions'))
    expect(revs.size).toBe(2)
    // Sin filtrar por owner, la consulta se deniega
    await expectDenied(getDocs(collection(db, 'sessions')))
    await expectDenied(getDocs(collection(db, 'comments')))
    await expectDenied(getDocs(collection(db, 'live')))
  })

  it('las suscripciones reales del provider cargan sin errores y las revisiones se leen del servidor', async () => {
    const state = await loadSources(STUDENT, 'student')
    expect(failedSources(state)).toEqual([])
    expect(state.sessions.every((s) => s.owner === STUDENT)).toBe(true)
    expect(state.sessions.some((s) => s.id === manualId)).toBe(true)
    expect(state.users.map((u) => u.uid).sort()).toEqual([ACCOUNTS.backup.uid, SUPERVISOR, STUDENT].sort())
    expect((await loadRevisions(manualId)).map((r) => r.id)).toEqual(['0', '1'])
  })
})

describe('supervisora', () => {
  let target: Session

  it('addComment guarda el comentario con la hora del servidor', async () => {
    await loginAs(ACCOUNTS.supervisor)
    const snap = await getDocs(collection(db, 'sessions'))
    const found = snap.docs.find((d) => d.data().method === 'live' && d.data().rev === 3)
    expect(found).toBeDefined()
    target = { ...(found!.data() as SessionDoc), id: found!.id }
    const me: AppUser = { uid: SUPERVISOR, role: 'supervisor', name: 'Profesora Demo' }

    await expectAppError(addComment(me, target, '   '), /Escribe un comentario/)
    await expectAppError(addComment(me, target, 'x'.repeat(2001)), /como máximo 2000 caracteres/)

    const t0 = Date.now()
    await addComment(me, target, '  Buen trabajo con el archivo.  ')
    const t1 = Date.now()
    const comments = await adminDb().collection('comments').get()
    expect(comments.size).toBe(1)
    const c = comments.docs[0].data()
    expect(sortedKeys(c)).toEqual(['author_uid', 'created_at', 'session_id', 'session_owner', 'text'])
    expect(c).toMatchObject({
      session_id: target.id,
      session_owner: STUDENT,
      author_uid: SUPERVISOR,
      text: 'Buen trabajo con el archivo.',
    })
    expectServerTime(c.created_at, t0, t1)
  })

  it('un session_owner falso se rechaza', async () => {
    await expectDenied(
      setDoc(doc(collection(db, 'comments')), {
        session_id: target.id,
        session_owner: SUPERVISOR,
        author_uid: SUPERVISOR,
        text: 'Comentario',
        created_at: serverTimestamp(),
      }),
    )
  })

  it('no puede escribir en sesiones ni en live', async () => {
    const before = await readDoc(`sessions/${target.id}`)
    // Con las funciones de la app
    await expectDenied(startSession(SUPERVISOR))
    await expectAppError(editSessionNote(target.id, 'Nota cambiada'), /Solo puedes modificar tus propias sesiones/)
    await expectAppError(voidSession(target.id, 'Anulada por la profesora'), /Solo puedes modificar tus propias sesiones/)
    await expectAppError(startSession(STUDENT), /Solo puedes registrar horas con tu propia cuenta/)
    await expectAppError(
      addManualSession(STUDENT, { date: madridDateKey(Date.now() - 2 * DAY), minutes: 60, note: 'Suplantación' }),
      /Solo puedes registrar horas con tu propia cuenta/,
    )

    // Con el SDK directamente
    await expectDenied(updateDoc(doc(db, 'sessions', target.id), { note: 'Cambiada' }))
    await expectDenied(
      runTransaction(db, async (tx) => {
        const ref = doc(db, 'sessions', target.id)
        const cur = (await tx.get(ref)).data() as SessionDoc
        tx.set(doc(ref, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() })
        tx.update(ref, { note: 'Cambiada', rev: cur.rev + 1, updated_at: serverTimestamp() })
      }),
    )
    await expectDenied(
      runTransaction(db, async (tx) => {
        const ref = doc(db, 'sessions', target.id)
        const cur = (await tx.get(ref)).data() as SessionDoc
        tx.set(doc(ref, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() })
        tx.update(ref, { voided: true, void_reason: 'Anulada por la profesora', rev: cur.rev + 1, updated_at: serverTimestamp() })
      }),
    )
    await expectDenied(deleteDoc(doc(db, 'sessions', target.id)))
    await expectDenied(rawManual(STUDENT, Date.now() - 2 * DAY, 60, 'Creada por la profesora'))
    await expectDenied(rawManual(SUPERVISOR, Date.now() - 2 * DAY, 60, 'Creada por la profesora'))
    await expectDenied(setDoc(doc(db, 'live', STUDENT), { session_id: target.id }))
    await expectDenied(setDoc(doc(db, 'users', SUPERVISOR), { role: 'student', name: 'x' }))
    expect(await readDoc(`sessions/${target.id}`)).toEqual(before)
  })

  it('no puede borrar el cerrojo de una sesión abierta del student', async () => {
    const id = await seedOpenSession(STUDENT, Date.now() - HOUR)
    await expectDenied(deleteDoc(doc(db, 'live', STUDENT)))
    await expectDenied(rawStop(STUDENT, null))
    expect(await readDoc(`live/${STUDENT}`)).toEqual({ session_id: id })
  })

  it('las lecturas de AppDataProvider están permitidas para la supervisora', async () => {
    await firstSnapshot(collection(db, 'sessions'))
    await firstSnapshot(collection(db, 'live'))
    await firstSnapshot(collection(db, 'comments'))
    await firstSnapshot(collection(db, 'users'))
    await firstSnapshot(doc(db, 'meta', 'backup'))
    const live = await getDocs(collection(db, 'live'))
    expect(live.docs.map((d) => d.id)).toEqual([STUDENT])
    const revs = await getDocs(collection(db, 'sessions', target.id, 'revisions'))
    expect(revs.size).toBe(3)
    const state = await loadSources(SUPERVISOR, 'supervisor')
    expect(failedSources(state)).toEqual([])
    expect(state.live.get(STUDENT)).toBeDefined()
    expect((await loadRevisions(target.id)).map((r) => r.id)).toEqual(['0', '1', '2'])
    // Reintento de addComment: la supervisora puede comprobar si un comentario ya existe
    expect(await inAbortedTransaction((tx) => existsInTransaction(tx, doc(collection(db, 'comments'))))).toBe(false)
  })

  it('el student ve el comentario y cierra la sesión abierta', async () => {
    await loginAs(ACCOUNTS.student)
    const mine = await getDocs(query(collection(db, 'comments'), where('session_owner', '==', STUDENT)))
    expect(mine.docs.map((d) => d.data().text)).toEqual(['Buen trabajo con el archivo.'])
    await stopSession(STUDENT, 'Fin de la jornada')
    expect(await readDoc(`live/${STUDENT}`)).toBeUndefined()
  })
})

describe('cuentas sin permisos', () => {
  it('cuenta sin perfil: inicia sesión pero todo se deniega', async () => {
    await loginAs(ACCOUNTS.noProfile)
    const uid = ACCOUNTS.noProfile.uid
    await expectDenied(getDoc(doc(db, 'users', uid)))
    await expectDenied(getDocs(collection(db, 'users')))
    await expectDenied(getDocs(query(collection(db, 'sessions'), where('owner', '==', uid))))
    await expectDenied(getDocs(query(collection(db, 'sessions'), where('owner', '==', STUDENT))))
    await expectDenied(getDoc(doc(db, 'live', uid)))
    await expectDenied(getDocs(query(collection(db, 'comments'), where('session_owner', '==', uid))))
    await expectDenied(getDoc(doc(db, 'meta', 'backup')))
    const before = await countDocs('sessions')
    await expectDenied(startSession(uid))
    await expectDenied(addManualSession(uid, { date: madridDateKey(Date.now() - DAY), minutes: 60, note: 'Sin perfil' }))
    expect(await countDocs('sessions')).toBe(before)
    expect(await readDoc(`live/${uid}`)).toBeUndefined()
  })

  it('cuenta backup: lee todo y no puede fichar', async () => {
    await loginAs(ACCOUNTS.backup)
    await firstSnapshot(collection(db, 'sessions'))
    await firstSnapshot(collection(db, 'live'))
    await firstSnapshot(collection(db, 'comments'))
    await expectDenied(startSession(ACCOUNTS.backup.uid))
    await expectDenied(setDoc(doc(db, 'meta', 'backup'), { last_backup_at: Timestamp.now(), docs: 1 }))
    await setDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp(), docs: 1 })
    expect(await readDoc('meta/backup')).toMatchObject({ docs: 1 })
  })

  it('sin iniciar sesión: todo se deniega', async () => {
    await signOutUser()
    expect(auth.currentUser).toBeNull()
    await expectDenied(getDoc(doc(db, 'users', STUDENT)))
    await expectDenied(getDocs(collection(db, 'sessions')))
    await expectDenied(getDoc(doc(db, 'meta', 'backup')))
    await expectAppError(startSession(STUDENT), /Tu sesión ha caducado/)
  })

  it('credenciales incorrectas dan un mensaje en español', async () => {
    const err = await signIn(ACCOUNTS.student.email, 'contraseña-mala').then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).not.toBeNull()
    expect(friendlyError(err)).toBe('Correo o contraseña incorrectos.')
  })
})
