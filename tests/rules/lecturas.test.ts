// Lecturas por rol: el student solo ve lo suyo (y sus consultas deben filtrar); supervisora y
// backup lo leen todo; sin perfil y anónimo, nada.
import { beforeEach, describe, expect, it } from 'vitest'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
} from 'firebase/firestore'
import {
  ago,
  BACKUP,
  DAY,
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
} from './helpers'

const t = setupEnv()

const commentData = (sessionId: string, owner: string) => ({
  session_id: sessionId, session_owner: owner, author_uid: SUPERVISOR, text: 'Bien', created_at: ago(HOUR),
})

beforeEach(async () => {
  await seedOpen(t, 's-open')
  await seedClosed(t, 's-closed')
  await seedManual(t, 's-manual')
  await seedOpen(t, 's-otra-open', { owner: OTHER })
  await seedClosed(t, 's-otra', { owner: OTHER })
  await t.seed('comments/c-propio', commentData('s-closed', STUDENT))
  await t.seed('comments/c-ajeno', commentData('s-otra', OTHER))
  await t.seed('meta/backup', { last_backup_at: ago(DAY), docs: 12 })
})

describe('Lecturas del student', () => {
  const db = () => t.db(STUDENT)

  it('listar sessions sin filtro → denegado', async () => {
    await denied(getDocs(collection(db(), 'sessions')))
  })

  it("listar sessions con where('owner','==',uid) → solo las suyas", async () => {
    const snap = await ok(getDocs(query(collection(db(), 'sessions'), where('owner', '==', STUDENT))))
    expect(snap.docs.map((d) => d.id).sort()).toEqual(['s-closed', 's-manual', 's-open'])
  })

  it('listar sessions filtrando por otro owner → denegado', async () => {
    await denied(getDocs(query(collection(db(), 'sessions'), where('owner', '==', OTHER))))
  })

  it('leer una sesión propia → permitido; ajena → denegado', async () => {
    await ok(getDoc(doc(db(), 'sessions', 's-closed')))
    await denied(getDoc(doc(db(), 'sessions', 's-otra')))
    await denied(getDoc(doc(db(), 'sessions', 's-otra-open')))
  })

  it('leer una sesión inexistente → denegado (no hay owner que comprobar)', async () => {
    await denied(getDoc(doc(db(), 'sessions', 'no-existe')))
  })

  it('revisiones propias → permitido; ajenas → denegado', async () => {
    await ok(getDocs(collection(db(), 'sessions', 's-closed', 'revisions')))
    await ok(getDoc(doc(db(), 'sessions', 's-closed', 'revisions', '0')))
    await denied(getDocs(collection(db(), 'sessions', 's-otra', 'revisions')))
    await denied(getDoc(doc(db(), 'sessions', 's-otra', 'revisions', '0')))
  })

  it('su live (exista o no) → permitido; el ajeno o el listado → denegado', async () => {
    const snap = await ok(getDoc(doc(db(), 'live', STUDENT)))
    expect(snap.data()).toEqual({ session_id: 's-open' })
    await ok(getDoc(doc(t.db(OTHER), 'live', OTHER)))
    await denied(getDoc(doc(db(), 'live', OTHER)))
    await denied(getDocs(collection(db(), 'live')))
  })

  it('su live cuando no existe → permitido (lo necesita START)', async () => {
    await t.remove(`live/${STUDENT}`)
    const snap = await ok(getDoc(doc(db(), 'live', STUDENT)))
    expect(snap.exists()).toBe(false)
  })

  it("comments con where('session_owner','==',uid) → solo los suyos", async () => {
    const snap = await ok(getDocs(query(collection(db(), 'comments'), where('session_owner', '==', STUDENT))))
    expect(snap.docs.map((d) => d.id)).toEqual(['c-propio'])
  })

  it('comments sin filtro o con otro session_owner → denegado', async () => {
    await denied(getDocs(collection(db(), 'comments')))
    await denied(getDocs(query(collection(db(), 'comments'), where('session_owner', '==', OTHER))))
  })

  it('un comentario propio → permitido; ajeno → denegado', async () => {
    await ok(getDoc(doc(db(), 'comments', 'c-propio')))
    await denied(getDoc(doc(db(), 'comments', 'c-ajeno')))
  })

  it('users y meta/backup → permitido', async () => {
    await ok(getDocs(collection(db(), 'users')))
    await ok(getDoc(doc(db(), 'users', SUPERVISOR)))
    await ok(getDoc(doc(db(), 'meta', 'backup')))
  })
})

describe.each([
  ['supervisora', SUPERVISOR],
  ['backup', BACKUP],
])('Lecturas de %s', (_name, uid) => {
  it('lee todas las sesiones, revisiones, live, comentarios, users y meta', async () => {
    const db = t.db(uid)
    const sessions = await ok(getDocs(collection(db, 'sessions')))
    expect(sessions.size).toBe(5)
    await ok(getDoc(doc(db, 'sessions', 's-otra')))
    await ok(getDocs(query(collection(db, 'sessions'), where('owner', '==', STUDENT))))
    await ok(getDocs(collection(db, 'sessions', 's-closed', 'revisions')))
    await ok(getDocs(collection(db, 'sessions', 's-otra', 'revisions')))
    await ok(getDoc(doc(db, 'sessions', 's-otra', 'revisions', '0')))
    expect((await ok(getDocs(collection(db, 'live')))).size).toBe(2)
    await ok(getDoc(doc(db, 'live', STUDENT)))
    expect((await ok(getDocs(collection(db, 'comments')))).size).toBe(2)
    await ok(getDoc(doc(db, 'comments', 'c-ajeno')))
    expect((await ok(getDocs(collection(db, 'users')))).size).toBe(4)
    await ok(getDoc(doc(db, 'meta', 'backup')))
  })

  it('no lee colecciones no previstas', async () => {
    await t.seed('otra/x', { a: 1 })
    await denied(getDoc(doc(t.db(uid), 'otra', 'x')))
    await denied(getDocs(collection(t.db(uid), 'otra')))
    await denied(getDoc(doc(t.db(uid), 'meta', 'otro')))
  })
})

describe.each([
  ['sin perfil', () => t.db(NO_PROFILE)],
  ['anónimo', () => t.anon()],
])('Lecturas %s', (_name, getDb) => {
  it('todo denegado', async () => {
    const db = getDb()
    await denied(getDocs(collection(db, 'users')))
    await denied(getDoc(doc(db, 'users', STUDENT)))
    await denied(getDoc(doc(db, 'users', NO_PROFILE)))
    await denied(getDocs(collection(db, 'sessions')))
    await denied(getDocs(query(collection(db, 'sessions'), where('owner', '==', NO_PROFILE))))
    await denied(getDocs(query(collection(db, 'sessions'), where('owner', '==', STUDENT))))
    await denied(getDoc(doc(db, 'sessions', 's-closed')))
    await denied(getDocs(collection(db, 'sessions', 's-closed', 'revisions')))
    await denied(getDocs(collection(db, 'live')))
    await denied(getDoc(doc(db, 'live', NO_PROFILE)))
    await denied(getDoc(doc(db, 'live', STUDENT)))
    await denied(getDocs(collection(db, 'comments')))
    await denied(getDocs(query(collection(db, 'comments'), where('session_owner', '==', STUDENT))))
    await denied(getDoc(doc(db, 'meta', 'backup')))
  })
})
