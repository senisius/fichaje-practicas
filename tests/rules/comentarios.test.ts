// Comentarios: solo la supervisora los crea, como autora, sobre sesiones reales; append-only.
import { describe, expect, it } from 'vitest'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import {
  ago,
  BACKUP,
  clientTime,
  comment,
  denied,
  HOUR,
  NO_PROFILE,
  ok,
  OTHER,
  seedClosed,
  seedManual,
  seedOpen,
  setupEnv,
  STUDENT,
  SUPERVISOR,
  text,
  without,
  type Mut,
} from './helpers'

const t = setupEnv()
const S = { id: 's-closed', owner: STUDENT }

describe('Comentarios (positivo)', () => {
  it('sobre una sesión cerrada, con hora del servidor', async () => {
    await seedClosed(t)
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, S, 'Bien documentado'))
    const snap = await getDocs(collection(t.db(SUPERVISOR), 'comments'))
    expect(snap.size).toBe(1)
    expect(snap.docs[0].data()).toMatchObject({ session_id: 's-closed', session_owner: STUDENT, author_uid: SUPERVISOR })
    expect(snap.docs[0].data().created_at).toBeInstanceOf(Timestamp)
  })

  it('sobre una sesión en curso', async () => {
    await seedOpen(t)
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, { id: 's-open', owner: STUDENT }, '¿Qué estás haciendo hoy?'))
  })

  it('sobre una sesión anulada y sobre una manual', async () => {
    await seedClosed(t, 's-closed', { voided: true, void_reason: 'Registrada por error', rev: 2 })
    await seedManual(t)
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, S, 'De acuerdo con la anulación'))
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, { id: 's-manual', owner: STUDENT }, 'Adjunta la memoria'))
  })

  it('texto de 1 y de 2000 caracteres', async () => {
    await seedClosed(t)
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, S, 'k'))
    await ok(comment(t.db(SUPERVISOR), SUPERVISOR, S, text(2000)))
  })

  it('con id fijo (setDoc)', async () => {
    await seedClosed(t)
    await ok(setDoc(doc(t.db(SUPERVISOR), 'comments', 'c-fijo'), {
      session_id: 's-closed', session_owner: STUDENT, author_uid: SUPERVISOR, text: 'Bien', created_at: serverTimestamp(),
    }))
  })
})

describe('Comentarios: negativos por campo', () => {
  const cases: [string, Mut][] = [
    ['author_uid ajeno', (c) => ({ ...c, author_uid: STUDENT })],
    ['session_owner falso', (c) => ({ ...c, session_owner: OTHER })],
    ['session_owner numérico', (c) => ({ ...c, session_owner: 1 })],
    ['sesión inexistente', (c) => ({ ...c, session_id: 'no-existe' })],
    ['session_id numérico', (c) => ({ ...c, session_id: 7 })],
    ['campo extra', (c) => ({ ...c, edited: false })],
    ['falta text', (c) => without(c, 'text')],
    ['falta created_at', (c) => without(c, 'created_at')],
    ['falta session_owner', (c) => without(c, 'session_owner')],
    ['texto vacío', (c) => ({ ...c, text: '' })],
    ['texto solo con espacios', (c) => ({ ...c, text: '   ' })],
    ['texto de 2001 caracteres', (c) => ({ ...c, text: text(2001) })],
    ['texto numérico', (c) => ({ ...c, text: 10 })],
    ['created_at del cliente', (c) => ({ ...c, created_at: clientTime() })],
    ['created_at en el pasado', (c) => ({ ...c, created_at: ago(HOUR) })],
  ]
  it.each(cases)('%s → denegado', async (_name, mut) => {
    await seedClosed(t)
    await denied(comment(t.db(SUPERVISOR), SUPERVISOR, S, 'Bien documentado', mut))
  })
})

describe('Comentarios: quién puede', () => {
  it('el student (aunque ponga su uid o el de la supervisora) → denegado', async () => {
    await seedClosed(t)
    await denied(comment(t.db(STUDENT), STUDENT, S, 'Gracias'))
    await denied(comment(t.db(STUDENT), SUPERVISOR, S, 'Todo perfecto'))
  })

  it('backup, sin perfil y anónimo → denegado', async () => {
    await seedClosed(t)
    await denied(comment(t.db(BACKUP), BACKUP, S, 'Hola'))
    await denied(comment(t.db(NO_PROFILE), NO_PROFILE, S, 'Hola'))
    await denied(addDoc(collection(t.anon(), 'comments'), {
      session_id: 's-closed', session_owner: STUDENT, author_uid: 'anon', text: 'Hola', created_at: serverTimestamp(),
    }))
  })
})

describe('Comentarios: append-only', () => {
  it('editar, sobrescribir o borrar → denegado para todos', async () => {
    await seedClosed(t)
    await t.seed('comments/c1', {
      session_id: 's-closed', session_owner: STUDENT, author_uid: SUPERVISOR, text: 'Bien', created_at: ago(HOUR),
    })
    const sup = t.db(SUPERVISOR)
    await denied(updateDoc(doc(sup, 'comments', 'c1'), { text: 'Muy bien' }))
    await denied(setDoc(doc(sup, 'comments', 'c1'), {
      session_id: 's-closed', session_owner: STUDENT, author_uid: SUPERVISOR, text: 'Muy bien', created_at: serverTimestamp(),
    }))
    await denied(deleteDoc(doc(sup, 'comments', 'c1')))
    for (const uid of [STUDENT, BACKUP, NO_PROFILE]) {
      await denied(updateDoc(doc(t.db(uid), 'comments', 'c1'), { text: 'x' }))
      await denied(deleteDoc(doc(t.db(uid), 'comments', 'c1')))
    }
    await denied(deleteDoc(doc(t.anon(), 'comments', 'c1')))
  })
})
