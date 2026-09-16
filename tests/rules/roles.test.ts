// Escrituras por rol: meta/backup, users y todo lo que supervisora, backup, sin perfil,
// anónimo u otro student no pueden escribir.
import { describe, it } from 'vitest'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore'
import {
  ago,
  BACKUP,
  clientTime,
  DAY,
  denied,
  manualInput,
  newLiveSession,
  newManualSession,
  NO_PROFILE,
  ok,
  OTHER,
  seedClosed,
  seedOpen,
  setupEnv,
  STUDENT,
  SUPERVISOR,
  without,
  writeBackupMark,
  type Mut,
} from './helpers'

const t = setupEnv()

describe('meta/backup', () => {
  it('backup la crea y la actualiza con la hora del servidor → permitido', async () => {
    const db = t.db(BACKUP)
    await ok(writeBackupMark(db))
    await ok(writeBackupMark(db, (d) => ({ ...d, docs: 0 })))
    await ok(updateDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp(), docs: 99 }))
  })

  const cases: [string, Mut][] = [
    ['hora del cliente', (d) => ({ ...d, last_backup_at: clientTime() })],
    ['hora pasada', (d) => ({ ...d, last_backup_at: ago(DAY) })],
    ['campo extra', (d) => ({ ...d, by: BACKUP })],
    ['sin docs', (d) => without(d, 'docs')],
    ['sin last_backup_at', (d) => without(d, 'last_backup_at')],
    ['docs como texto', (d) => ({ ...d, docs: '42' })],
    ['docs decimal', (d) => ({ ...d, docs: 4.5 })],
    ['docs negativo', (d) => ({ ...d, docs: -1 })],
  ]
  it.each(cases)('backup con %s → denegado', async (_name, mut) => {
    await denied(writeBackupMark(t.db(BACKUP), mut))
  })

  it('backup no puede borrarla ni escribir otros documentos de meta', async () => {
    const db = t.db(BACKUP)
    await ok(writeBackupMark(db))
    await denied(deleteDoc(doc(db, 'meta', 'backup')))
    await denied(setDoc(doc(db, 'meta', 'otro'), { last_backup_at: serverTimestamp(), docs: 1 }))
  })

  it('actualización parcial que añade un campo → denegado', async () => {
    await t.seed('meta/backup', { last_backup_at: ago(DAY), docs: 3 })
    await denied(updateDoc(doc(t.db(BACKUP), 'meta', 'backup'), { last_backup_at: serverTimestamp(), note: 'x' }))
  })

  it.each([
    ['student', STUDENT],
    ['supervisora', SUPERVISOR],
    ['sin perfil', NO_PROFILE],
  ])('%s escribiendo meta/backup → denegado', async (_name, uid) => {
    await t.seed('meta/backup', { last_backup_at: ago(DAY), docs: 3 })
    const db = t.db(uid)
    await denied(writeBackupMark(db))
    await denied(updateDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp() }))
    await denied(deleteDoc(doc(db, 'meta', 'backup')))
  })

  it('anónimo escribiendo meta/backup → denegado', async () => {
    await denied(writeBackupMark(t.anon()))
  })
})

describe('users: nadie escribe', () => {
  const contexts: [string, () => Firestore, string][] = [
    ['student', () => t.db(STUDENT), STUDENT],
    ['supervisora', () => t.db(SUPERVISOR), SUPERVISOR],
    ['backup', () => t.db(BACKUP), BACKUP],
    ['otro student', () => t.db(OTHER), OTHER],
    ['sin perfil', () => t.db(NO_PROFILE), NO_PROFILE],
    ['anónimo', () => t.anon(), 'anon'],
  ]
  it.each(contexts)('%s → denegado (crear, cambiar rol, borrar)', async (_name, getDb, uid) => {
    const db = getDb()
    await denied(setDoc(doc(db, 'users', uid), { role: 'supervisor', name: 'x' }))
    await denied(setDoc(doc(db, 'users', 'nuevo'), { role: 'student', name: 'x' }))
    await denied(updateDoc(doc(db, 'users', STUDENT), { role: 'supervisor' }))
    await denied(updateDoc(doc(db, 'users', STUDENT), { target_hours: 1 }))
    await denied(deleteDoc(doc(db, 'users', SUPERVISOR)))
  })
})

/**
 * Intenta todas las escrituras sobre las sesiones del student con este Firestore.
 * Con `own`, también START y manual a nombre propio (no aplica a otro student, que sí puede).
 */
async function allSessionWritesDenied(db: Firestore, uid: string, own: boolean) {
  if (own) {
    // START en batch (sin lecturas, para evaluar solo las reglas de escritura)
    const batch = writeBatch(db)
    const sRef = doc(collection(db, 'sessions'))
    batch.set(sRef, newLiveSession(uid))
    batch.set(doc(db, 'live', uid), { session_id: sRef.id })
    await denied(batch.commit())
    await denied(setDoc(doc(collection(db, 'sessions')), newManualSession(uid, manualInput())))
  }
  // START a nombre del student
  const b2 = writeBatch(db)
  const s2 = doc(collection(db, 'sessions'))
  b2.set(s2, newLiveSession(STUDENT))
  b2.set(doc(db, 'live', STUDENT), { session_id: s2.id })
  await denied(b2.commit())
  // Manual a nombre del student
  await denied(setDoc(doc(collection(db, 'sessions')), newManualSession(STUDENT, manualInput())))
  // STOP de la sesión abierta del student
  const cur = await t.read('sessions/s-open')
  const b3 = writeBatch(db)
  b3.set(doc(db, 'sessions/s-open/revisions/0'), { before: cur, at: serverTimestamp() })
  b3.update(doc(db, 'sessions/s-open'), {
    end_time: serverTimestamp(), adjusted: false, adjust_reason: '', note: '', rev: 1, updated_at: serverTimestamp(),
  })
  b3.delete(doc(db, 'live', STUDENT))
  await denied(b3.commit())
  // Nota y anulación de la cerrada, con revisión
  const closed = await t.read('sessions/s-closed')
  for (const patch of [{ note: 'x' }, { voided: true, void_reason: 'Registrada por error' }]) {
    const b = writeBatch(db)
    b.set(doc(db, 'sessions/s-closed/revisions/1'), { before: closed, at: serverTimestamp() })
    b.update(doc(db, 'sessions/s-closed'), { ...patch, rev: 2, updated_at: serverTimestamp() })
    await denied(b.commit())
  }
  // Escrituras sueltas
  await denied(updateDoc(doc(db, 'sessions/s-closed'), { note: 'x' }))
  await denied(deleteDoc(doc(db, 'sessions/s-closed')))
  await denied(setDoc(doc(db, 'sessions/s-closed/revisions/1'), { before: closed, at: serverTimestamp() }))
  await denied(deleteDoc(doc(db, 'sessions/s-closed/revisions/0')))
  await denied(deleteDoc(doc(db, 'live', STUDENT)))
  await denied(updateDoc(doc(db, 'live', STUDENT), { session_id: 's-closed' }))
}

describe('Escrituras de sesiones por quien no es el dueño', () => {
  it.each([
    ['supervisora', SUPERVISOR, true],
    ['backup', BACKUP, true],
    ['sin perfil', NO_PROFILE, true],
    ['otro student', OTHER, false],
  ])('%s → todo denegado', async (_name, uid, own) => {
    await seedOpen(t)
    await seedClosed(t)
    await allSessionWritesDenied(t.db(uid), uid, own)
  })

  it('anónimo → todo denegado', async () => {
    await seedOpen(t)
    await seedClosed(t)
    await allSessionWritesDenied(t.anon(), 'anon', true)
  })

  it('sin perfil y anónimo no pueden comentar', async () => {
    await seedClosed(t)
    for (const db of [t.db(NO_PROFILE), t.anon()]) {
      await denied(addDoc(collection(db, 'comments'), {
        session_id: 's-closed', session_owner: STUDENT, author_uid: NO_PROFILE, text: 'Hola', created_at: serverTimestamp(),
      }))
    }
  })

  it('colecciones no previstas → denegado para todos', async () => {
    for (const db of [t.db(STUDENT), t.db(SUPERVISOR), t.db(BACKUP), t.db(NO_PROFILE), t.anon()]) {
      await denied(setDoc(doc(db, 'otra', 'x'), { a: 1 }))
    }
  })
})
