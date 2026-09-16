// Editar nota, anular, inmutabilidad de sesiones cerradas y reglas de revisiones.
import { describe, expect, it } from 'vitest'
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  writeBatch,
  type DocumentData,
} from 'firebase/firestore'
import {
  ago,
  clientTime,
  denied,
  editNote,
  HOUR,
  MINUTE,
  ok,
  OTHER,
  patchSession,
  seedClosed,
  seedManual,
  seedOpen,
  setupEnv,
  start,
  stop,
  STUDENT,
  SUPERVISOR,
  text,
  voidSession,
  without,
  type PatchMut,
} from './helpers'

const t = setupEnv()
const VOID = 'Registrada por error'

describe('Nota (positivo, como el cliente)', () => {
  it('en una sesión abierta: no toca el cerrojo', async () => {
    const before = await seedOpen(t)
    await ok(editNote(t.db(STUDENT), 's-open', 'Revisando el manual'))
    const s = await t.read('sessions/s-open')
    expect(s).toMatchObject({ note: 'Revisando el manual', rev: 1, end_time: null })
    expect((await t.read('sessions/s-open/revisions/0'))?.before).toEqual(before)
    expect(await t.read(`live/${STUDENT}`)).toEqual({ session_id: 's-open' })
  })

  it('en una sesión live cerrada', async () => {
    await seedClosed(t)
    await ok(editNote(t.db(STUDENT), 's-closed', 'Nota corregida'))
    expect((await t.read('sessions/s-closed'))?.rev).toBe(2)
    expect((await t.read('sessions/s-closed/revisions/1'))?.before.note).toBe('Revisión de documentación')
  })

  it('vaciar la nota de una sesión live', async () => {
    await seedClosed(t)
    await ok(editNote(t.db(STUDENT), 's-closed', ''))
  })

  it('en una sesión ajustada', async () => {
    await seedClosed(t, 's-closed', { adjusted: true, adjust_reason: 'Olvidé parar al salir' })
    await ok(editNote(t.db(STUDENT), 's-closed', 'Nota'))
  })

  it('en una entrada manual, con 5 caracteres', async () => {
    await seedManual(t)
    await ok(editNote(t.db(STUDENT), 's-manual', 'abcde'))
  })

  it('con 2000 caracteres', async () => {
    await seedManual(t)
    await ok(editNote(t.db(STUDENT), 's-manual', text(2000)))
  })

  it('sin cambiar el texto (solo sube rev)', async () => {
    await seedManual(t)
    await ok(editNote(t.db(STUDENT), 's-manual', 'Preparar la memoria'))
  })
})

describe('Nota: negativos', () => {
  it('manual con menos de 5 caracteres → denegado', async () => {
    await seedManual(t)
    await denied(editNote(t.db(STUDENT), 's-manual', 'abcd'))
    await denied(editNote(t.db(STUDENT), 's-manual', text(8, ' ')))
    await denied(editNote(t.db(STUDENT), 's-manual', ''))
  })

  it('más de 2000 caracteres → denegado', async () => {
    await seedClosed(t)
    await denied(editNote(t.db(STUDENT), 's-closed', text(2001)))
  })

  it('nota no textual → denegado', async () => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', { note: 42 }))
    await denied(patchSession(t.db(STUDENT), 's-closed', { note: null }))
  })

  it('en una sesión anulada → denegado', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: VOID, rev: 2 })
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota'))
  })

  it('en una sesión de otro student → denegado', async () => {
    const cur = await seedClosed(t, 's-otra', { owner: OTHER })
    await denied(editNote(t.db(STUDENT), 's-otra', 'Nota', { cur }))
    // uid-otra sí puede
    await ok(editNote(t.db(OTHER), 's-otra', 'Nota'))
  })

  const withNote: [string, DocumentData][] = [
    ['adjusted', { adjusted: true }],
    ['adjust_reason', { adjust_reason: 'Olvidé parar al salir' }],
    ['end_time', { end_time: ago(MINUTE) }],
    ['start_time', { start_time: ago(5 * HOUR) }],
    ['owner', { owner: OTHER }],
    ['method', { method: 'manual' }],
    ['created_at', { created_at: serverTimestamp() }],
    ['voided', { voided: true }],
    ['clave extra', { status: 'cerrada' }],
  ]
  it.each(withNote)('nota + %s → denegado', async (_name, extra) => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', { note: 'Nota', ...extra }))
  })
})

describe('Anular (positivo, como el cliente)', () => {
  it('una sesión live cerrada', async () => {
    const before = await seedClosed(t)
    await ok(voidSession(t.db(STUDENT), 's-closed', VOID))
    expect(await t.read('sessions/s-closed')).toMatchObject({ voided: true, void_reason: VOID, rev: 2 })
    expect((await t.read('sessions/s-closed/revisions/1'))?.before).toEqual(before)
  })

  it('una entrada manual', async () => {
    await seedManual(t)
    await ok(voidSession(t.db(STUDENT), 's-manual', VOID))
    expect((await t.read('sessions/s-manual/revisions/0'))?.before.voided).toBe(false)
  })

  it('una sesión ajustada', async () => {
    await seedClosed(t, 's-closed', { adjusted: true, adjust_reason: 'Olvidé parar al salir' })
    await ok(voidSession(t.db(STUDENT), 's-closed', VOID))
  })

  it('con motivo de 10 y de 500 caracteres', async () => {
    await seedClosed(t, 's-a')
    await seedManual(t, 's-b')
    await ok(voidSession(t.db(STUDENT), 's-a', text(10)))
    await ok(voidSession(t.db(STUDENT), 's-b', text(500)))
  })
})

describe('Anular: negativos', () => {
  it('una sesión abierta → denegado', async () => {
    await seedOpen(t)
    await denied(voidSession(t.db(STUDENT), 's-open', VOID))
  })

  it('desanular → denegado', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: VOID, rev: 2 })
    await denied(patchSession(t.db(STUDENT), 's-closed', { voided: false, void_reason: '' }))
    await denied(patchSession(t.db(STUDENT), 's-closed', { voided: false }))
  })

  it('anular dos veces → denegado', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: VOID, rev: 2 })
    await denied(voidSession(t.db(STUDENT), 's-closed', 'Otro motivo distinto'))
  })

  it('cambiar el motivo de una anulada → denegado', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: VOID, rev: 2 })
    await denied(patchSession(t.db(STUDENT), 's-closed', { void_reason: 'Otro motivo distinto' }))
  })

  const reasons: [string, unknown][] = [
    ['9 caracteres', text(9)],
    ['501 caracteres', text(501)],
    ['solo espacios', text(12, ' ')],
    ['vacío', ''],
    ['numérico', 1234567890],
  ]
  it.each(reasons)('motivo %s → denegado', async (_name, reason) => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', { voided: true, void_reason: reason }))
  })

  const patches: [string, DocumentData][] = [
    ['voided como texto', { voided: 'true', void_reason: VOID }],
    ['motivo sin anular', { void_reason: VOID }],
    ['anular + nota', { voided: true, void_reason: VOID, note: 'Nota nueva' }],
    ['anular + end_time', { voided: true, void_reason: VOID, end_time: ago(MINUTE) }],
    ['anular + adjusted', { voided: true, void_reason: VOID, adjusted: true }],
  ]
  it.each(patches)('%s → denegado', async (_name, patch) => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', patch))
  })

  it('una sesión de otro student → denegado', async () => {
    const cur = await seedClosed(t, 's-otra', { owner: OTHER })
    await denied(voidSession(t.db(STUDENT), 's-otra', VOID, { cur }))
  })
})

describe('Sesión cerrada inmutable', () => {
  /** Cambios prohibidos; `otherMethod` es el método distinto del de la sesión. */
  const changes = (otherMethod: string): [string, DocumentData][] => [
    ['method', { method: otherMethod }],
    ['owner', { owner: OTHER }],
    ['start_time', { start_time: ago(4 * HOUR) }],
    ['end_time', { end_time: ago(10 * MINUTE) }],
    ['end_time a null (reabrir)', { end_time: null }],
    ['created_at', { created_at: serverTimestamp() }],
    ['adjusted', { adjusted: true, adjust_reason: 'Olvidé parar al salir' }],
  ]
  it.each(changes('manual'))('cambiar %s (con revisión) → denegado', async (_name, patch) => {
    await seedClosed(t)
    await denied(patchSession(t.db(STUDENT), 's-closed', patch))
  })

  it.each(changes('live'))('cambiar %s en una manual → denegado', async (_name, patch) => {
    await seedManual(t)
    await denied(patchSession(t.db(STUDENT), 's-manual', patch))
  })

  it('updateDoc directo sin rev ni revisión → denegado', async () => {
    await seedClosed(t)
    await denied(updateDoc(doc(t.db(STUDENT), 'sessions', 's-closed'), { note: 'x' }))
  })

  it('borrar sesiones (cerrada, abierta, manual) → denegado', async () => {
    await seedClosed(t)
    await seedOpen(t)
    await seedManual(t)
    const db = t.db(STUDENT)
    for (const id of ['s-closed', 's-open', 's-manual']) await denied(deleteDoc(doc(db, 'sessions', id)))
  })
})

describe('Revisiones y rev: negativos', () => {
  const muts: [string, PatchMut][] = [
    ['sin revisión', { skipRevision: true }],
    ['revisión con id siguiente', { revId: (cur) => String(cur.rev + 1) }],
    ['revisión con id anterior', { revId: (cur) => String(cur.rev - 1) }],
    ['before sin una clave', { revision: (r) => ({ ...r, before: without(r.before, 'end_time') }) }],
    ['before con clave extra', { revision: (r) => ({ ...r, before: { ...r.before, extra: true } }) }],
    ['before con end_time nulo', { revision: (r) => ({ ...r, before: { ...r.before, end_time: null } }) }],
    ['before con end_time desplazado', {
      revision: (r) => ({ ...r, before: { ...r.before, end_time: Timestamp.fromMillis(r.before.end_time.toMillis() + 1000) } }),
    }],
    ['before con la nota nueva', { revision: (r) => ({ ...r, before: { ...r.before, note: 'Nota nueva' } }) }],
    ['before como texto', { revision: (r) => ({ ...r, before: JSON.stringify(r.before) }) }],
    ['at del cliente', { revision: (r) => ({ ...r, at: clientTime() }) }],
    ['revisión con clave extra', { revision: (r) => ({ ...r, author: STUDENT }) }],
    ['rev + 2', { update: (u) => ({ ...u, rev: u.rev + 1 }) }],
    ['rev sin cambiar', { update: (u) => ({ ...u, rev: u.rev - 1 }) }],
    ['rev decimal', { update: (u) => ({ ...u, rev: u.rev + 0.5 }) }],
    ['updated_at del cliente', { update: (u) => ({ ...u, updated_at: clientTime() }) }],
    ['updated_at sin cambiar', { update: (u) => without(u, 'updated_at') }],
  ]
  it.each(muts)('nota: %s → denegado', async (_name, mut) => {
    await seedClosed(t)
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota nueva', mut))
  })

  it.each(muts)('anular: %s → denegado', async (_name, mut) => {
    await seedClosed(t)
    await denied(voidSession(t.db(STUDENT), 's-closed', VOID, mut))
  })

  it('rev -0 (double) sobre una sesión con rev -1 escrita desde la consola → denegado', async () => {
    // -0 == -1 + 1 en las reglas; sin `is int` se aceptaría y la revisión siguiente ("-0.0") no cuadraría con el cliente
    await seedClosed(t, 's-closed', { rev: -1 })
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota nueva', { update: (u) => ({ ...u, rev: -0 }) }))
    // Control: con rev 0 entero sí se permite
    await ok(editNote(t.db(STUDENT), 's-closed', 'Nota nueva'))
  })

  it('rev 1,5 → denegado', async () => {
    await seedClosed(t)
    await denied(editNote(t.db(STUDENT), 's-closed', 'Nota nueva', { update: (u) => ({ ...u, rev: 1.5 }) }))
  })

  it('revisión suelta sin cambiar la sesión → denegado', async () => {
    const cur = await seedClosed(t)
    await denied(setDoc(doc(t.db(STUDENT), 'sessions/s-closed/revisions/1'), { before: cur, at: serverTimestamp() }))
  })

  it('una revisión extra con otro id en el mismo commit → denegado', async () => {
    const cur = await seedClosed(t)
    const db = t.db(STUDENT)
    const commit = (extraId: string | null) => {
      const batch = writeBatch(db)
      batch.set(doc(db, 'sessions/s-closed/revisions/1'), { before: cur, at: serverTimestamp() })
      if (extraId) batch.set(doc(db, `sessions/s-closed/revisions/${extraId}`), { before: cur, at: serverTimestamp() })
      batch.update(doc(db, 'sessions/s-closed'), { note: 'Nota nueva', rev: 2, updated_at: serverTimestamp() })
      return batch.commit()
    }
    await denied(commit('7'))
    await ok(commit(null))
  })

  it('revisión de una sesión inexistente → denegado', async () => {
    const db = t.db(STUDENT)
    await denied(setDoc(doc(db, 'sessions/no-existe/revisions/0'), { before: {}, at: serverTimestamp() }))
  })

  it('revisión en la sesión de otro student, aunque esta cambie → denegado', async () => {
    const cur = await seedClosed(t, 's-otra', { owner: OTHER })
    const db = t.db(STUDENT)
    const batch = writeBatch(db)
    batch.set(doc(db, 'sessions/s-otra/revisions/1'), { before: cur, at: serverTimestamp() })
    batch.update(doc(db, 'sessions/s-otra'), { note: 'x', rev: 2, updated_at: serverTimestamp() })
    await denied(batch.commit())
  })

  it('modificar o borrar una revisión existente → denegado', async () => {
    const db = t.db(STUDENT)
    const id = await ok(start(db, STUDENT))
    await ok(stop(db, STUDENT, 'Nota'))
    const ref = doc(db, 'sessions', id, 'revisions', '0')
    await denied(updateDoc(ref, { 'before.note': 'x' }))
    await denied(setDoc(ref, { before: {}, at: serverTimestamp() }))
    await denied(deleteDoc(ref))
    await denied(deleteDoc(doc(t.db(SUPERVISOR), 'sessions', id, 'revisions', '0')))
  })
})

describe('Flujo completo', () => {
  it('START → nota → STOP ajustado → nota → anular deja rev 4 y 4 revisiones', async () => {
    const db = t.db(STUDENT)
    const id = await ok(start(db, STUDENT))
    await ok(editNote(db, id, 'Empiezo con el informe'))
    // Fin ajustado entre el inicio (hora del servidor) y ahora
    const startMs = ((await t.read(`sessions/${id}`))!.start_time as Timestamp).toMillis()
    await ok(stop(db, STUDENT, 'Informe', { at: new Date(startMs + 1), reason: 'Terminé antes de lo previsto' }))
    await ok(editNote(db, id, 'Informe revisado'))
    await ok(voidSession(db, id, 'La repito como manual'))
    const s = await t.read(`sessions/${id}`)
    expect(s).toMatchObject({ rev: 4, voided: true, adjusted: true, note: 'Informe revisado' })
    const revs = await Promise.all([0, 1, 2, 3].map((n) => t.read(`sessions/${id}/revisions/${n}`)))
    expect(revs.map((r) => r?.before.rev)).toEqual([0, 1, 2, 3])
    expect(revs[2]?.before.adjusted).toBe(true)
    // Tras anular, nada más
    await denied(editNote(db, id, 'Otra'))
  })
})
