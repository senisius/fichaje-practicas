// Los 12 tests obligatorios de docs/PROPUESTA.md §4, uno por bloque.
import { describe, expect, it } from 'vitest'
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import {
  addManual,
  ago,
  BACKUP,
  clientTime,
  comment,
  DAY,
  denied,
  editNote,
  HOUR,
  manualInput,
  MINUTE,
  NO_PROFILE,
  ok,
  OTHER,
  OTHER_PROGRAM_START_DAYS,
  patchSession,
  seedClosed,
  seedOpen,
  setupEnv,
  start,
  stop,
  STUDENT,
  SUPERVISOR,
  voidSession,
  writeBackupMark,
} from './helpers'

const t = setupEnv()
const REASON = 'Olvidé parar al salir'

describe('1. START', () => {
  it('START correcto → permitido', async () => {
    const id = await ok(start(t.db(STUDENT), STUDENT))
    expect(await t.read(`live/${STUDENT}`)).toEqual({ session_id: id })
    const s = await t.read(`sessions/${id}`)
    expect(s?.end_time).toBeNull()
    expect(s?.start_time).toBeInstanceOf(Timestamp)
  })

  it('un segundo START → denegado', async () => {
    const db = t.db(STUDENT)
    await ok(start(db, STUDENT))
    await denied(start(db, STUDENT, { skipClientCheck: true }))
  })
})

describe('2. START con hora del cliente', () => {
  it('start_time puesto por el cliente → denegado', async () => {
    await denied(start(t.db(STUDENT), STUDENT, { session: (d) => ({ ...d, start_time: clientTime() }) }))
  })
})

describe('3. Cerrojo live', () => {
  it('STOP sin borrar live → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, { skipLiveDelete: true }))
  })

  it('borrar live sin cerrar la sesión → denegado', async () => {
    await seedOpen(t)
    await denied(deleteDoc(doc(t.db(STUDENT), 'live', STUDENT)))
  })
})

describe('4. Hora de fin', () => {
  it('STOP normal con end_time distinto de la hora del servidor → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, {
      update: (u) => ({ ...u, end_time: Timestamp.fromMillis(Date.now() - MINUTE) }),
    }))
  })

  it('STOP ajustado con fin en el futuro → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', { at: new Date(Date.now() + 10 * MINUTE), reason: REASON }))
  })

  it('STOP ajustado de más de 16 h → denegado', async () => {
    const start = Date.now() - 20 * HOUR
    await seedOpen(t, 's-open', { start_time: Timestamp.fromMillis(start) })
    await denied(stop(t.db(STUDENT), STUDENT, '', { at: new Date(start + 16 * HOUR + MINUTE), reason: REASON }))
  })

  it('STOP ajustado con motivo de menos de 10 caracteres → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', { at: new Date(Date.now() - 30 * MINUTE), reason: 'olvidé' }))
  })
})

describe('5. Revisiones', () => {
  it('STOP sin revisión → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, { skipRevision: true }))
  })

  it('nota sin revisión → denegado', async () => {
    await seedClosed(t)
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota nueva', { skipRevision: true }))
  })

  it('anular sin revisión → denegado', async () => {
    await seedClosed(t)
    await denied(voidSession(t.db(STUDENT), 's-closed', 'Registrada por error', { skipRevision: true }))
  })

  it('STOP con before falseado → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, {
      revision: (r) => ({ ...r, before: { ...r.before, start_time: ago(HOUR) } }),
    }))
  })

  it('nota con before falseado → denegado', async () => {
    await seedClosed(t)
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota nueva', {
      revision: (r) => ({ ...r, before: { ...r.before, note: 'otra cosa' } }),
    }))
  })

  it('anular con before falseado → denegado', async () => {
    await seedClosed(t)
    await denied(voidSession(t.db(STUDENT), 's-closed', 'Registrada por error', {
      revision: (r) => ({ ...r, before: { ...r.before, end_time: ago(4 * HOUR) } }),
    }))
  })
})

describe('6. Sesión cerrada inmutable', () => {
  it('cambiar el inicio → denegado', async () => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', { start_time: ago(5 * HOUR) }))
  })

  it('cambiar el fin → denegado', async () => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', { end_time: ago(10 * MINUTE) }))
  })

  it('deshacer la anulación → denegado', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: 'Registrada por error' })
    await denied(patchSession(t.db(STUDENT), 's-closed', { voided: false, void_reason: '' }))
  })

  it('borrar la sesión → denegado', async () => {
    await seedClosed(t)
    await denied(deleteDoc(doc(t.db(STUDENT), 'sessions', 's-closed')))
  })
})

describe('7. Entrada manual fuera de límites', () => {
  it('fin en el futuro → denegado', async () => {
    const startMs = Date.now() - HOUR
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput({ startMs, endMs: startMs + 2 * HOUR })))
  })

  it('más de 16 h → denegado', async () => {
    const startMs = Date.now() - 3 * DAY
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput({ startMs, endMs: startMs + 16 * HOUR + MINUTE })))
  })

  it('inicio anterior a program_start → denegado', async () => {
    // uid-otra empezó hace 10 días: así el límite de 31 días no interviene.
    const startMs = Date.now() - (OTHER_PROGRAM_START_DAYS + 1) * DAY
    await denied(addManual(t.db(OTHER), OTHER, manualInput({ startMs })))
  })

  it('más de 31 días de antigüedad → denegado', async () => {
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput({ startMs: Date.now() - 32 * DAY })))
  })

  it('nota de menos de 5 caracteres → denegado', async () => {
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput({ note: 'abcd' })))
  })
})

describe('8. La supervisora no escribe sesiones ni live', () => {
  it('crear una sesión live → denegado', async () => {
    await denied(start(t.db(SUPERVISOR), SUPERVISOR))
  })

  it('crear una sesión manual → denegado', async () => {
    await denied(addManual(t.db(SUPERVISOR), SUPERVISOR, manualInput()))
    await denied(addManual(t.db(SUPERVISOR), STUDENT, manualInput()))
  })

  it('modificar una sesión → denegado', async () => {
    await seedClosed(t)
    const db = t.db(SUPERVISOR)
    await denied(editNote(db, 's-closed', 'Nota de la profesora'))
    await denied(updateDoc(doc(db, 'sessions', 's-closed'), { note: 'x' }))
  })

  it('cerrar la sesión del student → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(SUPERVISOR), STUDENT))
  })

  it('crear o borrar live → denegado', async () => {
    await seedOpen(t)
    const db = t.db(SUPERVISOR)
    await denied(setDoc(doc(db, 'live', SUPERVISOR), { session_id: 's-open' }))
    await denied(deleteDoc(doc(db, 'live', STUDENT)))
  })
})

describe('9. Comentarios', () => {
  it('la supervisora comenta → permitido', async () => {
    await seedClosed(t)
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, { id: 's-closed', owner: STUDENT }, 'Bien documentado'))
  })

  it('el student comenta → denegado', async () => {
    await seedClosed(t)
    await denied(comment(t.db(STUDENT), STUDENT, { id: 's-closed', owner: STUDENT }, 'Hola'))
  })

  it('session_owner falso → denegado', async () => {
    await seedClosed(t)
    await denied(comment(t.db(SUPERVISOR), SUPERVISOR, { id: 's-closed', owner: OTHER }, 'Bien'))
  })

  it('editar o borrar un comentario → denegado', async () => {
    await seedClosed(t)
    await t.seed('comments/c1', {
      session_id: 's-closed', session_owner: STUDENT, author_uid: SUPERVISOR, text: 'Bien', created_at: ago(HOUR),
    })
    const db = t.db(SUPERVISOR)
    await denied(updateDoc(doc(db, 'comments', 'c1'), { text: 'Muy bien' }))
    await denied(deleteDoc(doc(db, 'comments', 'c1')))
  })
})

describe('10. Listado de sesiones del student', () => {
  it('sin where(owner) → denegado', async () => {
    await seedClosed(t)
    await denied(getDocs(collection(t.db(STUDENT), 'sessions')))
  })
})

describe('11. Sin perfil y escrituras en users', () => {
  it('cuenta sin users/{uid}: todo denegado', async () => {
    await seedClosed(t)
    await t.seed('meta/backup', { last_backup_at: ago(DAY), docs: 3 })
    const db = t.db(NO_PROFILE)
    await denied(getDoc(doc(db, 'users', NO_PROFILE)))
    await denied(getDocs(collection(db, 'users')))
    await denied(getDocs(query(collection(db, 'sessions'), where('owner', '==', NO_PROFILE))))
    await denied(getDoc(doc(db, 'sessions', 's-closed')))
    await denied(getDoc(doc(db, 'live', NO_PROFILE)))
    await denied(getDocs(collection(db, 'comments')))
    await denied(getDoc(doc(db, 'meta', 'backup')))
    await denied(start(db, NO_PROFILE))
    await denied(addManual(db, NO_PROFILE, manualInput()))
    await denied(setDoc(doc(db, 'users', NO_PROFILE), { role: 'student', name: 'Yo' }))
  })

  it('cualquier escritura en users → denegada', async () => {
    for (const uid of [STUDENT, SUPERVISOR, BACKUP]) {
      const db = t.db(uid)
      await denied(setDoc(doc(db, 'users', uid), { role: 'supervisor', name: 'x' }))
      await denied(updateDoc(doc(db, 'users', uid), { role: 'supervisor' }))
      await denied(deleteDoc(doc(db, 'users', uid)))
    }
  })
})

describe('12. Cuenta backup e igualdad del mapa before', () => {
  it('backup puede leer', async () => {
    await seedClosed(t)
    const db = t.db(BACKUP)
    await ok(getDocs(collection(db, 'users')))
    await ok(getDocs(collection(db, 'sessions')))
    await ok(getDocs(collection(db, 'sessions', 's-closed', 'revisions')))
    await ok(getDocs(collection(db, 'live')))
    await ok(getDocs(collection(db, 'comments')))
    await ok(getDoc(doc(db, 'meta', 'backup')))
  })

  it('backup no puede escribir en sessions', async () => {
    await seedOpen(t)
    await seedClosed(t)
    const db = t.db(BACKUP)
    await denied(start(db, BACKUP))
    await denied(addManual(db, BACKUP, manualInput()))
    await denied(editNote(db, 's-closed', 'Nota'))
    await denied(stop(db, STUDENT))
    await denied(deleteDoc(doc(db, 'sessions', 's-closed')))
  })

  it('meta/backup con hora del cliente → denegado; con hora del servidor → permitido', async () => {
    const db = t.db(BACKUP)
    await denied(writeBackupMark(db, (d) => ({ ...d, last_backup_at: clientTime() })))
    await ok(writeBackupMark(db))
    await ok(setDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp(), docs: 43 }))
  })

  it('positivo: la igualdad del mapa before funciona con Timestamps y null', async () => {
    const db = t.db(STUDENT)
    const id = await ok(start(db, STUDENT))
    await ok(editNote(db, id, 'Nota con la sesión abierta'))        // before con end_time null
    await ok(stop(db, STUDENT, 'Nota final'))                       // before con end_time null
    await ok(editNote(db, id, 'Nota corregida'))                    // before con end_time Timestamp
    const rev0 = await t.read(`sessions/${id}/revisions/0`)
    const rev2 = await t.read(`sessions/${id}/revisions/2`)
    expect(rev0?.before.end_time).toBeNull()
    expect(rev2?.before.end_time).toBeInstanceOf(Timestamp)
    expect(rev2?.before.note).toBe('Nota final')
  })
})
