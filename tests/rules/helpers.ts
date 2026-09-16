// Utilidades compartidas por los tests de firestore.rules.
// Las funciones start/stop/patchSession/addManual reproducen EXACTAMENTE lo que hace el cliente
// (docs/PROPUESTA.md §5): mismas lecturas, mismo orden de escrituras y serverTimestamp().
// Los parámetros `mut` solo existen para fabricar variantes maliciosas en los casos negativos.
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach } from 'vitest'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestContext,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  writeBatch,
  type DocumentData,
  type Firestore,
} from 'firebase/firestore'

// Los tests provocan denegaciones a propósito: sin esto el SDK llena la salida de avisos.
setLogLevel('error')

export const PROJECT_ID = 'demo-fichaje'

export const STUDENT = 'uid-estudiante'
export const SUPERVISOR = 'uid-profesora'
export const BACKUP = 'uid-backup'
export const NO_PROFILE = 'uid-sinperfil'
/** Otro student distinto, para probar la propiedad de los documentos. */
export const OTHER = 'uid-otra'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

/** Días desde el inicio de prácticas de cada student en el seed. */
export const STUDENT_PROGRAM_START_DAYS = 60
export const OTHER_PROGRAM_START_DAYS = 10

export const ok = assertSucceeds
export const denied = assertFails

export const ts = (ms: number) => Timestamp.fromMillis(ms)
export const ago = (ms: number) => ts(Date.now() - ms)
export const text = (n: number, ch = 'a') => ch.repeat(n)
/**
 * Hora puesta por el cliente (reloj 3 s atrasado). No se usa Timestamp.now(): el emulador resuelve
 * request.time al milisegundo y, con la conexión abierta, a veces coincide con la hora del cliente.
 */
export const clientTime = () => ts(Date.now() - 3000)

/** Host y puerto del emulador, desde la variable que define `firebase emulators:exec`. */
function emulatorHost(): { host: string; port: number } {
  const raw = process.env.FIRESTORE_EMULATOR_HOST
  if (!raw) throw new Error('FIRESTORE_EMULATOR_HOST no está definido: lanza los tests con `npm run test:rules`')
  const i = raw.lastIndexOf(':')
  return { host: raw.slice(0, i), port: Number(raw.slice(i + 1)) }
}

// ---------- Entorno ----------

export interface Env {
  /** Firestore como el usuario indicado (SDK modular sobre el contexto de pruebas). */
  db(uid: string): Firestore
  anon(): Firestore
  /** Escribe saltándose las reglas. */
  seed(path: string, data: DocumentData): Promise<void>
  /** Lee saltándose las reglas (undefined si no existe). */
  read(path: string): Promise<DocumentData | undefined>
  /** Borra saltándose las reglas. */
  remove(path: string): Promise<void>
}

const asModular = (ctx: RulesTestContext) => ctx.firestore() as unknown as Firestore

/**
 * Registra los hooks de vitest: un entorno por fichero y, antes de cada test,
 * base de datos vacía con los perfiles de usuario sembrados.
 * Cada usuario (y el acceso sin reglas) reutiliza un único contexto durante todo el fichero:
 * crear una app de Firebase por llamada hace la suite mucho más lenta.
 */
export function setupEnv(): Env {
  let env: RulesTestEnvironment | undefined
  let adminDb: Firestore | undefined
  let releaseAdmin: (() => void) | undefined
  let adminDone: Promise<void> | undefined
  const users = new Map<string, Firestore>()
  let anonDb: Firestore | undefined

  const current = () => {
    if (!env) throw new Error('Entorno de pruebas no inicializado')
    return env
  }
  const admin = () => {
    if (!adminDb) throw new Error('Entorno de pruebas no inicializado')
    return adminDb
  }

  beforeAll(async () => {
    const testEnv = await initializeTestEnvironment({
      projectId: PROJECT_ID,
      // RULES_FILE permite probar variantes de las reglas (p. ej. mutaciones); por defecto, las reales.
      firestore: { ...emulatorHost(), rules: readFileSync(process.env.RULES_FILE ?? 'firestore.rules', 'utf8') },
    })
    env = testEnv
    // El contexto sin reglas solo es válido dentro del callback: se deja pendiente hasta afterAll.
    await new Promise<void>((ready) => {
      adminDone = testEnv.withSecurityRulesDisabled((ctx) => {
        adminDb = asModular(ctx)
        ready()
        return new Promise<void>((resolve) => {
          releaseAdmin = resolve
        })
      })
    })
  })
  afterAll(async () => {
    releaseAdmin?.()
    await adminDone
    await env?.cleanup()
  })
  beforeEach(async () => {
    await current().clearFirestore()
    const now = Date.now()
    const batch = writeBatch(admin())
    batch.set(doc(admin(), 'users', STUDENT), {
      role: 'student',
      name: 'Estudiante',
      email: 'estudiante@demo.test',
      target_hours: 298,
      program_start: ts(now - STUDENT_PROGRAM_START_DAYS * DAY),
    })
    batch.set(doc(admin(), 'users', SUPERVISOR), { role: 'supervisor', name: 'Profesora', email: 'profesora@demo.test' })
    batch.set(doc(admin(), 'users', BACKUP), { role: 'backup', name: 'backup' })
    batch.set(doc(admin(), 'users', OTHER), {
      role: 'student',
      name: 'Otra',
      email: 'otra@demo.test',
      target_hours: 298,
      program_start: ts(now - OTHER_PROGRAM_START_DAYS * DAY),
    })
    // uid-sinperfil no tiene documento en users.
    await batch.commit()
  })

  return {
    db: (uid) => {
      let db = users.get(uid)
      if (!db) {
        db = asModular(current().authenticatedContext(uid))
        users.set(uid, db)
      }
      return db
    },
    anon: () => (anonDb ??= asModular(current().unauthenticatedContext())),
    seed: (path, data) => setDoc(doc(admin(), path), data),
    read: async (path) => (await getDoc(doc(admin(), path))).data(),
    remove: (path) => deleteDoc(doc(admin(), path)),
  }
}

// ---------- Datos de ejemplo ----------

/** Sesión con las 12 claves. Por defecto: live abierta del student, empezada hace 2 h. */
export function sessionData(over: DocumentData = {}): DocumentData {
  const start = Date.now() - 2 * HOUR
  return {
    owner: STUDENT,
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
    ...over,
  }
}

/** Siembra una sesión live abierta y su cerrojo live/{owner}. */
export async function seedOpen(t: Env, id = 's-open', over: DocumentData = {}): Promise<DocumentData> {
  const data = sessionData(over)
  await t.seed(`sessions/${id}`, data)
  await t.seed(`live/${data.owner}`, { session_id: id })
  return data
}

/** Siembra una sesión live cerrada (2 h, terminada hace 1 h) con rev 1 y su revisión 0. */
export async function seedClosed(t: Env, id = 's-closed', over: DocumentData = {}): Promise<DocumentData> {
  const start = Date.now() - 3 * HOUR
  const end = start + 2 * HOUR
  const base = sessionData({ start_time: ts(start), created_at: ts(start), updated_at: ts(start) })
  const data = sessionData({
    start_time: ts(start),
    end_time: ts(end),
    note: 'Revisión de documentación',
    rev: 1,
    created_at: ts(start),
    updated_at: ts(end),
    ...over,
  })
  await t.seed(`sessions/${id}`, data)
  await t.seed(`sessions/${id}/revisions/0`, { before: { ...base, owner: data.owner }, at: ts(end) })
  return data
}

/** Siembra una entrada manual cerrada (3 h, hace 2 días). */
export async function seedManual(t: Env, id = 's-manual', over: DocumentData = {}): Promise<DocumentData> {
  const start = Date.now() - 2 * DAY
  const data = sessionData({
    method: 'manual',
    start_time: ts(start),
    end_time: ts(start + 3 * HOUR),
    note: 'Preparar la memoria',
    created_at: ago(DAY),
    updated_at: ago(DAY),
    ...over,
  })
  await t.seed(`sessions/${id}`, data)
  return data
}

// ---------- Réplicas de las operaciones del cliente ----------

export type Mut = (d: DocumentData) => DocumentData
const same: Mut = (d) => d

/** Payload de una sesión live nueva, igual que en START. */
export function newLiveSession(uid: string): DocumentData {
  return {
    owner: uid, method: 'live', start_time: serverTimestamp(), end_time: null,
    adjusted: false, adjust_reason: '', voided: false, void_reason: '', note: '', rev: 0,
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
  }
}

/** Payload de una entrada manual, igual que en addManualSession. */
export function newManualSession(uid: string, input: { startMs: number; endMs: number; note: string }): DocumentData {
  return {
    owner: uid, method: 'manual',
    start_time: Timestamp.fromMillis(input.startMs), end_time: Timestamp.fromMillis(input.endMs),
    adjusted: false, adjust_reason: '', voided: false, void_reason: '', note: input.note, rev: 0,
    created_at: serverTimestamp(), updated_at: serverTimestamp(),
  }
}

export interface StartMut {
  /** Modifica los datos de la sesión nueva. */
  session?: Mut
  /** Modifica el cerrojo; null = no escribir el cerrojo. */
  live?: Mut | null
  /** Usa este id de sesión en vez de uno nuevo. */
  sessionId?: string
  /** Cerrojo de este otro uid. */
  liveUid?: string
  /** Salta la comprobación del cliente para probar que la regla también lo impide. */
  skipClientCheck?: boolean
}

/** START (PROPUESTA §5.1). Devuelve el id de la sesión nueva. */
export async function start(db: Firestore, uid: string, mut: StartMut = {}): Promise<string> {
  return runTransaction(db, async (tx) => {
    const liveRef = doc(db, 'live', mut.liveUid ?? uid)
    if ((await tx.get(liveRef)).exists() && !mut.skipClientCheck) throw new Error('Ya hay una sesión en curso')
    const sRef = mut.sessionId ? doc(db, 'sessions', mut.sessionId) : doc(collection(db, 'sessions'))
    tx.set(sRef, (mut.session ?? same)(newLiveSession(uid)))
    if (mut.live !== null) tx.set(liveRef, (mut.live ?? same)({ session_id: sRef.id }))
    return sRef.id
  })
}

export interface ChangeMut {
  /** Id de la revisión a partir del rev leído (por defecto String(rev)). */
  revId?: (cur: DocumentData) => string
  /** Modifica el payload completo de la revisión ({ before, at }). */
  revision?: Mut
  /** Modifica el payload del update de la sesión. */
  update?: Mut
  /** No escribe la revisión. */
  skipRevision?: boolean
}

export interface StopMut extends ChangeMut {
  /** No borra live/{uid}. */
  skipLiveDelete?: boolean
  /** Sesión a cerrar sin leer live (para sesiones ajenas o sin cerrojo). */
  sessionId?: string
  /** Datos "leídos" de la sesión cuando no se pueden leer (sesión ajena). */
  cur?: DocumentData
}

/** STOP normal o ajustado (PROPUESTA §5.2). */
export async function stop(
  db: Firestore,
  uid: string,
  note = '',
  fix?: { at: Date; reason: string },
  mut: StopMut = {},
): Promise<void> {
  await runTransaction(db, async (tx) => {
    const liveRef = doc(db, 'live', uid)
    let sessionId = mut.sessionId
    if (!sessionId) {
      const live = await tx.get(liveRef)
      if (!live.exists()) throw new Error('No hay sesión en curso')
      sessionId = live.data().session_id as string
    }
    const sRef = doc(db, 'sessions', sessionId)
    const cur = mut.cur ?? (await tx.get(sRef)).data()!
    if (!mut.skipRevision) {
      const revId = mut.revId ? mut.revId(cur) : String(cur.rev)
      tx.set(doc(sRef, 'revisions', revId), (mut.revision ?? same)({ before: cur, at: serverTimestamp() }))
    }
    tx.update(sRef, (mut.update ?? same)({
      end_time: fix ? Timestamp.fromDate(fix.at) : serverTimestamp(),
      adjusted: !!fix, adjust_reason: fix?.reason ?? '',
      note, rev: cur.rev + 1, updated_at: serverTimestamp(),
    }))
    if (!mut.skipLiveDelete) tx.delete(liveRef)
  })
}

export interface PatchMut extends ChangeMut {
  /** Datos "leídos" de la sesión cuando no se pueden leer (sesión ajena). */
  cur?: DocumentData
}

/** Editar nota o anular (PROPUESTA §5.5); en los negativos, `patch` puede llevar cualquier campo. */
export async function patchSession(db: Firestore, sid: string, patch: DocumentData, mut: PatchMut = {}): Promise<void> {
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'sessions', sid)
    const cur = mut.cur ?? (await tx.get(ref)).data()!
    if (!mut.skipRevision) {
      const revId = mut.revId ? mut.revId(cur) : String(cur.rev)
      tx.set(doc(ref, 'revisions', revId), (mut.revision ?? same)({ before: cur, at: serverTimestamp() }))
    }
    tx.update(ref, (mut.update ?? same)({ ...patch, rev: cur.rev + 1, updated_at: serverTimestamp() }))
  })
}

export const editNote = (db: Firestore, sid: string, note: string, mut?: PatchMut) =>
  patchSession(db, sid, { note }, mut)

export const voidSession = (db: Firestore, sid: string, reason: string, mut?: PatchMut) =>
  patchSession(db, sid, { voided: true, void_reason: reason }, mut)

/** Entrada manual (PROPUESTA §5.4) con inicio y fin en ms. */
export async function addManual(
  db: Firestore,
  uid: string,
  input: { startMs: number; endMs: number; note: string },
  mut: Mut = same,
): Promise<void> {
  await setDoc(doc(collection(db, 'sessions')), mut(newManualSession(uid, input)))
}

/** Entrada manual válida por defecto: hace 2 días, 3 h. */
export function manualInput(over: Partial<{ startMs: number; endMs: number; note: string }> = {}) {
  const startMs = over.startMs ?? Date.now() - 2 * DAY
  return { startMs, endMs: over.endMs ?? startMs + 3 * HOUR, note: over.note ?? 'Preparar la memoria' }
}

/** Comentario de la supervisora (lo que hará addComment). */
export async function comment(
  db: Firestore,
  author: string,
  session: { id: string; owner: string },
  body: string,
  mut: Mut = same,
): Promise<void> {
  await addDoc(collection(db, 'comments'), mut({
    session_id: session.id, session_owner: session.owner, author_uid: author,
    text: body, created_at: serverTimestamp(),
  }))
}

/** Marca de backup (lo que hará scripts/backup.mjs). */
export async function writeBackupMark(db: Firestore, mut: Mut = same): Promise<void> {
  await setDoc(doc(db, 'meta', 'backup'), mut({ last_backup_at: serverTimestamp(), docs: 42 }))
}

/** Quita una clave de un objeto (para casos de "clave faltante"). */
export function without(d: DocumentData, key: string): DocumentData {
  const copy = { ...d }
  delete copy[key]
  return copy
}
