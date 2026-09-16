// Cerrojo live/{uid}: solo se crea junto a una sesión live nueva y solo se borra al cerrarla.
// Se usan batches (sin lecturas) para comprobar las reglas de escritura aisladas.
import { describe, expect, it } from 'vitest'
import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import {
  denied,
  manualInput,
  newLiveSession,
  newManualSession,
  ok,
  OTHER,
  seedClosed,
  seedOpen,
  sessionData,
  setupEnv,
  STUDENT,
} from './helpers'

const t = setupEnv()

/** START en batch: sesión (id nuevo o dado) + cerrojo con el contenido indicado. */
function startBatch(uid: string, opts: { session?: DocumentData | null; live: (id: string) => DocumentData; liveUid?: string; sessionId?: string }) {
  const db = t.db(uid)
  const batch = writeBatch(db)
  const sRef = opts.sessionId ? doc(db, 'sessions', opts.sessionId) : doc(collection(db, 'sessions'))
  if (opts.session !== null) batch.set(sRef, opts.session ?? newLiveSession(uid))
  batch.set(doc(db, 'live', opts.liveUid ?? uid), opts.live(sRef.id))
  return batch.commit()
}

describe('live: creación', () => {
  it('START en batch (sesión + cerrojo) → permitido', async () => {
    await ok(startBatch(STUDENT, { live: (id) => ({ session_id: id }) }))
  })

  it('cerrojo solo, sin sesión → denegado', async () => {
    await denied(startBatch(STUDENT, { session: null, live: (id) => ({ session_id: id }) }))
  })

  it('cerrojo solo, apuntando a una sesión propia cerrada existente → denegado', async () => {
    await seedClosed(t)
    await denied(setDoc(doc(t.db(STUDENT), 'live', STUDENT), { session_id: 's-closed' }))
  })

  it('cerrojo solo, apuntando a una sesión propia abierta existente (sin cerrojo) → denegado', async () => {
    await t.seed('sessions/s-huerfana', sessionData())
    await denied(setDoc(doc(t.db(STUDENT), 'live', STUDENT), { session_id: 's-huerfana' }))
  })

  it('cerrojo apuntando a una sesión abierta de otro student → denegado', async () => {
    await t.seed('sessions/s-otra', sessionData({ owner: OTHER }))
    await denied(setDoc(doc(t.db(STUDENT), 'live', STUDENT), { session_id: 's-otra' }))
  })

  it('cerrojo apuntando a una manual nueva del mismo batch → denegado', async () => {
    await denied(startBatch(STUDENT, {
      session: newManualSession(STUDENT, manualInput()),
      live: (id) => ({ session_id: id }),
    }))
  })

  it('cerrojo de otro uid → denegado', async () => {
    await denied(startBatch(STUDENT, { live: (id) => ({ session_id: id }), liveUid: OTHER }))
  })

  it('START que además crea el cerrojo de otro student (lo bloquearía) → denegado', async () => {
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    const sRef = doc(collection(db, 'sessions'))
    batch.set(sRef, newLiveSession(STUDENT))
    batch.set(doc(db, 'live', STUDENT), { session_id: sRef.id })
    batch.set(doc(db, 'live', OTHER), { session_id: sRef.id })
    await denied(batch.commit())
  })

  it('cerrojo con clave extra → denegado', async () => {
    await denied(startBatch(STUDENT, { live: (id) => ({ session_id: id, since: serverTimestamp() }) }))
  })

  it('cerrojo sin session_id → denegado', async () => {
    await denied(startBatch(STUDENT, { live: () => ({}) }))
  })

  it('cerrojo con session_id numérico → denegado', async () => {
    await denied(startBatch(STUDENT, { live: () => ({ session_id: 123 }) }))
  })

  it('cerrojo con session_id de otra sesión nueva del mismo batch → denegado', async () => {
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    const a = doc(collection(db, 'sessions'))
    const b = doc(collection(db, 'sessions'))
    batch.set(a, newLiveSession(STUDENT))
    batch.set(b, newLiveSession(STUDENT))
    batch.set(doc(db, 'live', STUDENT), { session_id: b.id })
    await denied(batch.commit())
  })

  it('sesión live sin cerrojo → denegado', async () => {
    const db = t.db(STUDENT)
    await denied(setDoc(doc(collection(db, 'sessions')), newLiveSession(STUDENT)))
  })
})

describe('live: segunda sesión', () => {
  it('set sobre un cerrojo existente (segundo START) → denegado', async () => {
    await seedOpen(t)
    await denied(startBatch(STUDENT, { live: (id) => ({ session_id: id }) }))
    expect(await t.read(`live/${STUDENT}`)).toEqual({ session_id: 's-open' })
  })

  it('actualizar el session_id del cerrojo → denegado', async () => {
    await seedOpen(t)
    await seedClosed(t)
    await denied(updateDoc(doc(t.db(STUDENT), 'live', STUDENT), { session_id: 's-closed' }))
  })

  it('reescribir el cerrojo con el mismo contenido → denegado', async () => {
    await seedOpen(t)
    await denied(setDoc(doc(t.db(STUDENT), 'live', STUDENT), { session_id: 's-open' }))
  })
})

describe('live: borrado', () => {
  it('borrar sin cerrar la sesión → denegado', async () => {
    await seedOpen(t)
    await denied(deleteDoc(doc(t.db(STUDENT), 'live', STUDENT)))
  })

  it('borrar el cerrojo de otro student → denegado', async () => {
    await seedOpen(t, 's-otra', { owner: OTHER })
    await denied(deleteDoc(doc(t.db(STUDENT), 'live', OTHER)))
  })

  it('cerrojo huérfano (su sesión ya está cerrada): solo lo borra su dueño', async () => {
    await seedClosed(t, 's-otra', { owner: OTHER })
    await t.seed(`live/${OTHER}`, { session_id: 's-otra' })
    await denied(deleteDoc(doc(t.db(STUDENT), 'live', OTHER)))
    await ok(deleteDoc(doc(t.db(OTHER), 'live', OTHER)))
  })

  it('borrar el cerrojo cerrando la sesión pero sin revisión → denegado', async () => {
    await seedOpen(t)
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    batch.update(doc(db, 'sessions', 's-open'), { end_time: serverTimestamp(), rev: 1, updated_at: serverTimestamp() })
    batch.delete(doc(db, 'live', STUDENT))
    await denied(batch.commit())
  })

  it('borrar el cerrojo anulando la sesión abierta → denegado', async () => {
    const cur = await seedOpen(t)
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    batch.set(doc(db, 'sessions/s-open/revisions/0'), { before: cur, at: serverTimestamp() })
    batch.update(doc(db, 'sessions', 's-open'), {
      voided: true, void_reason: 'Registrada por error', rev: 1, updated_at: serverTimestamp(),
    })
    batch.delete(doc(db, 'live', STUDENT))
    await denied(batch.commit())
  })

  it('STOP en batch (revisión + cierre + borrado) → permitido', async () => {
    const cur = await seedOpen(t)
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    batch.set(doc(db, 'sessions/s-open/revisions/0'), { before: cur, at: serverTimestamp() })
    batch.update(doc(db, 'sessions', 's-open'), {
      end_time: serverTimestamp(), adjusted: false, adjust_reason: '', note: '', rev: 1, updated_at: serverTimestamp(),
    })
    batch.delete(doc(db, 'live', STUDENT))
    await ok(batch.commit())
  })
})
