// Utilidades de los tests de integración: Admin SDK contra los emuladores (se salta las reglas)
// para preparar datos y comprobar lo que ha escrito la app de verdad.
import { deleteApp, initializeApp, type App } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { Timestamp as AdminTimestamp, getFirestore, type DocumentData } from 'firebase-admin/firestore'
import { expect } from 'vitest'
import { AppError, errorCode, friendlyError } from '../../src/data/api'
import { EMULATOR_AUTH_PORT, EMULATOR_FIRESTORE_PORT, EMULATOR_PROJECT_ID } from '../../src/data/firebase'

export const PROJECT_ID = EMULATOR_PROJECT_ID
const FIRESTORE_HOST = `127.0.0.1:${EMULATOR_FIRESTORE_PORT}`
const AUTH_HOST = `127.0.0.1:${EMULATOR_AUTH_PORT}`

// El Admin SDK debe hablar con los mismos emuladores que src/data/firebase.ts.
for (const [name, host, port] of [
  ['FIRESTORE_EMULATOR_HOST', FIRESTORE_HOST, EMULATOR_FIRESTORE_PORT],
  ['FIREBASE_AUTH_EMULATOR_HOST', AUTH_HOST, EMULATOR_AUTH_PORT],
] as const) {
  const current = process.env[name]
  if (current && !current.endsWith(`:${port}`)) {
    throw new Error(`${name}=${current}, pero la app usa el puerto ${port}: revisa firebase.json`)
  }
  process.env[name] = host
}
process.env.GCLOUD_PROJECT = PROJECT_ID
delete process.env.GOOGLE_APPLICATION_CREDENTIALS
// Sin esto firebase-admin intenta detectar el servidor de metadatos de Google Cloud y avisa al fallar
process.env.METADATA_SERVER_DETECTION = 'none'

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export interface Account {
  uid: string
  email: string
  password: string
}

/** Cuentas de docs/CONTRATO.md (solo existen en el emulador). */
export const ACCOUNTS = {
  student: { uid: 'uid-estudiante', email: 'estudiante@demo.test', password: 'demo-estudiante' },
  supervisor: { uid: 'uid-profesora', email: 'profesora@demo.test', password: 'demo-profesora' },
  backup: { uid: 'uid-backup', email: 'backup@demo.test', password: 'demo-backup' },
  noProfile: { uid: 'uid-sinperfil', email: 'sinperfil@demo.test', password: 'demo-sinperfil' },
} satisfies Record<string, Account>

export const SESSION_KEYS = [
  'adjust_reason',
  'adjusted',
  'created_at',
  'end_time',
  'method',
  'note',
  'owner',
  'rev',
  'start_time',
  'updated_at',
  'void_reason',
  'voided',
]

export const sortedKeys = (d: DocumentData | undefined): string[] => Object.keys(d ?? {}).sort()

// ---------- Admin ----------

let adminApp: App | undefined

function adminInstance(): App {
  adminApp ??= initializeApp({ projectId: PROJECT_ID }, 'integration-admin')
  return adminApp
}

export const adminDb = () => getFirestore(adminInstance())
export const adminAuth = () => getAuth(adminInstance())
export const ats = (ms: number) => AdminTimestamp.fromMillis(ms)

export async function closeAdmin(): Promise<void> {
  if (adminApp) await deleteApp(adminApp)
  adminApp = undefined
}

/** Borra todos los datos de los dos emuladores. */
export async function resetEmulators(): Promise<void> {
  const urls = [
    `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents`,
    `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts`,
  ]
  for (const url of urls) {
    const res = await fetch(url, { method: 'DELETE' })
    if (!res.ok) throw new Error(`El emulador respondió ${res.status} al borrar ${url}`)
  }
}

/** Crea las 4 cuentas y los 3 perfiles (sinperfil queda sin users/{uid}). */
export async function seedAccounts(programStartMs: number): Promise<void> {
  const auth = adminAuth()
  for (const a of Object.values(ACCOUNTS)) {
    await auth.createUser({ uid: a.uid, email: a.email, password: a.password, emailVerified: true })
  }
  const db = adminDb()
  await db.doc(`users/${ACCOUNTS.student.uid}`).set({
    role: 'student',
    name: 'Estudiante Demo',
    email: ACCOUNTS.student.email,
    target_hours: 298,
    program_start: ats(programStartMs),
  })
  await db.doc(`users/${ACCOUNTS.supervisor.uid}`).set({
    role: 'supervisor',
    name: 'Profesora Demo',
    email: ACCOUNTS.supervisor.email,
  })
  await db.doc(`users/${ACCOUNTS.backup.uid}`).set({ role: 'backup', name: 'Copia de seguridad' })
}

export async function readDoc(path: string): Promise<DocumentData | undefined> {
  const snap = await adminDb().doc(path).get()
  return snap.exists ? snap.data() : undefined
}

/** Revisiones de una sesión por id ('0', '1'…). */
export async function readRevisions(sessionId: string): Promise<Map<string, DocumentData>> {
  const snap = await adminDb().collection(`sessions/${sessionId}/revisions`).get()
  return new Map(snap.docs.map((d) => [d.id, d.data()]))
}

export async function countDocs(collection: string): Promise<number> {
  return (await adminDb().collection(collection).get()).size
}

/** Sesión live abierta desde startMs, con su cerrojo live/{uid} (como la dejaría un START). */
export async function seedOpenSession(uid: string, startMs: number): Promise<string> {
  const db = adminDb()
  const ref = db.collection('sessions').doc()
  const t = ats(startMs)
  const batch = db.batch()
  batch.set(ref, {
    owner: uid,
    method: 'live',
    start_time: t,
    end_time: null,
    adjusted: false,
    adjust_reason: '',
    voided: false,
    void_reason: '',
    note: '',
    rev: 0,
    created_at: t,
    updated_at: t,
  })
  batch.set(db.doc(`live/${uid}`), { session_id: ref.id })
  await batch.commit()
  return ref.id
}

// ---------- Aserciones ----------

interface Millis {
  toMillis(): number
}

/** Marca de tiempo puesta por el servidor durante la operación (mismo reloj que el emulador). */
export function expectServerTime(value: unknown, fromMs: number, toMs: number): void {
  expect(value).toBeInstanceOf(AdminTimestamp)
  const ms = (value as Millis).toMillis()
  expect(ms).toBeGreaterThanOrEqual(fromMs - 2000)
  expect(ms).toBeLessThanOrEqual(toMs + 2000)
}

export function sameInstant(a: unknown, b: unknown): boolean {
  return a instanceof AdminTimestamp && b instanceof AdminTimestamp && a.isEqual(b)
}

async function rejection(p: Promise<unknown>): Promise<unknown> {
  return p.then(
    () => {
      throw new Error('Se esperaba un error y la operación ha terminado bien')
    },
    (err: unknown) => err,
  )
}

/** Error de validación del cliente (AppError) con un mensaje claro. */
export async function expectAppError(p: Promise<unknown>, message: RegExp): Promise<AppError> {
  const err = await rejection(p)
  expect(err).toBeInstanceOf(AppError)
  expect((err as AppError).message).toMatch(message)
  expect(friendlyError(err)).toBe((err as AppError).message)
  return err as AppError
}

/** Rechazo de las reglas (permission-denied), con mensaje en español. */
export async function expectDenied(p: Promise<unknown>): Promise<void> {
  const err = await rejection(p)
  expect(errorCode(err)).toBe('permission-denied')
  expect(friendlyError(err)).toMatch(/El servidor ha rechazado la operación/)
}

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
