// Acceso a Firebase. Las transiciones siguen docs/CONTRATO.md y firestore.rules.
// Todas las escrituras van en runTransaction: fallan sin conexión y nunca quedan en cola.
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from 'firebase/auth'
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  type DocumentReference,
  type FieldValue,
  type Transaction,
} from 'firebase/firestore'
import { MAX_SESSION_HOURS, MIN_PASSWORD_LENGTH } from '../lib/limits'
import { MAX_SESSION_MS, formatDateTime } from '../lib/time'
import {
  cleanText,
  manualInterval,
  manualTimeOf,
  validateAdjustedStop,
  validateComment,
  validateManual,
  validateNote,
  validateVoidReason,
  type ManualInput,
  type ValidationResult,
} from '../lib/validation'
import type { AppUser, CommentDoc, LiveDoc, Session, SessionDoc, UserDoc } from '../types'
import { auth, db } from './firebase'
import { clearAllNoteDrafts } from './note-draft'

// Correos de Auth (restablecer contraseña) en español
auth.languageCode = 'es'

/** Longitud mínima que la app exige al cambiar la contraseña. */
export { MIN_PASSWORD_LENGTH }

/** Error con un mensaje ya pensado para mostrarlo tal cual. */
export class AppError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppError'
  }
}

// ---------- Utilidades internas ----------

function ensureOnline(): void {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new AppError('Sin conexión a internet. Conéctate y vuelve a intentarlo: no se ha guardado nada.')
  }
}

function throwIfInvalid(r: ValidationResult): void {
  if (r.errors.length > 0) throw new AppError(r.errors.join(' '))
}

function requireUid(): string {
  const uid = auth.currentUser?.uid
  if (!uid) throw new AppError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
  return uid
}

function assertSelf(uid: string): void {
  if (requireUid() !== uid) throw new AppError('Solo puedes registrar horas con tu propia cuenta.')
}

/** Código de un error de Firebase ('permission-denied', 'auth/…') o null. */
export function errorCode(e: unknown): string | null {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    const code = (e as { code: unknown }).code
    return typeof code === 'string' ? code : null
  }
  return null
}

/** Las 12 claves exactas de una sesión (las marcas de tiempo pueden ser serverTimestamp()). */
type SessionWrite = { [K in keyof SessionDoc]: SessionDoc[K] | FieldValue }

function writeRevision(tx: Transaction, sRef: DocumentReference, cur: SessionDoc): void {
  // `before` es la copia exacta leída en la transacción (las reglas la comparan con el documento)
  tx.set(doc(sRef, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() })
}

// Señales internas para abortar una transacción sin escribir nada
const NO_CHANGE = new Error('sin cambios')
const ALREADY_DONE = new Error('ya hecho')

/**
 * Dentro de una transacción: true si el documento existe. Las reglas deniegan al student leer una
 * sesión inexistente, así que una lectura denegada cuenta como "no existe".
 *
 * Se usa en los reintentos: el SDK repite la transacción si el commit falla con un error transitorio,
 * y el intento anterior puede haberse guardado aunque se perdiera la respuesta.
 */
export async function existsInTransaction(tx: Transaction, ref: DocumentReference): Promise<boolean> {
  return tx.get(ref).then(
    (snap) => snap.exists(),
    (e: unknown) => (errorCode(e) === 'permission-denied' ? false : Promise.reject(e)),
  )
}

// Cuando las reglas rechazan una hora que el cliente dio por buena, casi siempre es el reloj del dispositivo
const STOP_REJECTED =
  'El servidor ha rechazado la hora de fin. Puede que el reloj de este dispositivo no esté en hora o que la sesión ya supere las 16 h. Comprueba la hora del dispositivo y, si han pasado más de 16 h, usa «Terminé antes / olvidé parar» para indicar la hora real.'
const ADJUSTED_STOP_REJECTED =
  'El servidor ha rechazado la hora de fin indicada: tiene que ser anterior a la hora actual del servidor y como mucho 16 h después del inicio. Puede que el reloj de este dispositivo no esté en hora: compruébalo y vuelve a intentarlo.'
const MANUAL_REJECTED =
  'El servidor ha rechazado la entrada: no puede terminar en el futuro, empezar hace más de 31 días ni antes del inicio de las prácticas. Puede que el reloj de este dispositivo no esté en hora: compruébalo y vuelve a intentarlo.'

// ---------- Desfase del reloj ----------
// startSession guarda la hora local aproximada del commit; al llegar el start_time del servidor,
// la diferencia estima (hora servidor - hora cliente) sin escrituras extra.

export interface ClockSample {
  uid: string
  sessionId: string
  /** Hora del cliente (ms) en el momento estimado del commit. */
  clientMs: number
}

const SAMPLE_KEY = 'fichaje-practicas:clock-sample'
let sampleCache: ClockSample | null | undefined
const sampleListeners = new Set<() => void>()
let knownSkewMs = 0

function sessionStore(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage
  } catch {
    return null
  }
}

function isClockSample(v: unknown): v is ClockSample {
  const o = v as ClockSample | null
  return (
    typeof o === 'object' &&
    o !== null &&
    typeof o.uid === 'string' &&
    typeof o.sessionId === 'string' &&
    typeof o.clientMs === 'number' &&
    Number.isFinite(o.clientMs)
  )
}

/** Última muestra de reloj (referencia estable mientras no cambie). */
export function getClockSample(): ClockSample | null {
  if (sampleCache === undefined) {
    sampleCache = null
    try {
      const raw = sessionStore()?.getItem(SAMPLE_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : null
      if (isClockSample(parsed)) sampleCache = parsed
    } catch {
      // almacenamiento no disponible o dato corrupto: sin muestra
    }
  }
  return sampleCache
}

export function subscribeClockSample(cb: () => void): () => void {
  sampleListeners.add(cb)
  return () => {
    sampleListeners.delete(cb)
  }
}

function setClockSample(s: ClockSample | null): void {
  sampleCache = s
  try {
    const store = sessionStore()
    if (s) store?.setItem(SAMPLE_KEY, JSON.stringify(s))
    else store?.removeItem(SAMPLE_KEY)
  } catch {
    // sin almacenamiento: queda solo en memoria
  }
  for (const cb of sampleListeners) cb()
}

/** Hora servidor - hora cliente a partir de una muestra y del start_time confirmado por el servidor. */
export function skewFromSample(sample: ClockSample, serverStartMs: number): number {
  return serverStartMs - sample.clientMs
}

/** El provider comunica aquí el desfase estimado para que las validaciones usen la hora del servidor. */
export function setServerSkewMs(ms: number): void {
  knownSkewMs = Number.isFinite(ms) ? ms : 0
}

function serverNowFor(uid: string, sessionId: string, serverStartMs: number): number {
  const s = getClockSample()
  if (s && s.uid === uid && s.sessionId === sessionId) return Date.now() + skewFromSample(s, serverStartMs)
  return Date.now() + knownSkewMs
}

// ---------- Autenticación ----------

export async function signIn(email: string, password: string): Promise<void> {
  const e = cleanText(email)
  if (!e) throw new AppError('Escribe tu correo.')
  if (!password) throw new AppError('Escribe tu contraseña.')
  ensureOnline()
  await signInWithEmailAndPassword(auth, e, password)
}

export async function signOutUser(): Promise<void> {
  setClockSample(null)
  knownSkewMs = 0
  // Los borradores de notas no deben quedarse en un equipo compartido
  clearAllNoteDrafts()
  await signOut(auth)
}

/** Envía el correo de "he olvidado mi contraseña". No revela si la cuenta existe. */
export async function sendPasswordReset(email: string): Promise<void> {
  const e = cleanText(email)
  if (!e) throw new AppError('Escribe el correo de tu cuenta.')
  ensureOnline()
  auth.languageCode = 'es'
  try {
    await sendPasswordResetEmail(auth, e)
  } catch (err) {
    // No revelar si la cuenta existe
    if (errorCode(err) === 'auth/user-not-found') return
    throw err
  }
}

/** Reautentica con la contraseña actual y la cambia. */
export async function changePassword(current: string, next: string): Promise<void> {
  const user = auth.currentUser
  if (!user || !user.email) throw new AppError('Tu sesión ha caducado. Vuelve a iniciar sesión.')
  if (!current) throw new AppError('Escribe tu contraseña actual.')
  if (next.length < MIN_PASSWORD_LENGTH) {
    throw new AppError(`La nueva contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  }
  if (next === current) throw new AppError('La nueva contraseña tiene que ser distinta de la actual.')
  ensureOnline()
  try {
    await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, current))
  } catch (err) {
    const code = errorCode(err)
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' || code === 'auth/invalid-login-credentials') {
      throw new AppError('La contraseña actual no es correcta.')
    }
    throw err
  }
  await updatePassword(user, next)
}

// ---------- Acciones del student ----------

/** START: crea la sesión live con hora del servidor y el cerrojo live/{uid}. Devuelve el id. */
export async function startSession(uid: string): Promise<string> {
  ensureOnline()
  assertSelf(uid)
  const liveRef = doc(db, 'live', uid)
  const attempted = new Set<string>()
  const resumed: { id: string | null } = { id: null }
  const clickMs = Date.now()
  let id: string
  try {
    id = await runTransaction(db, async (tx) => {
      const live = await tx.get(liveRef)
      if (live.exists()) {
        const current = (live.data() as LiveDoc).session_id
        // Un intento anterior de esta misma llamada llegó a guardarse (respuesta perdida)
        if (attempted.has(current)) {
          resumed.id = current
          throw ALREADY_DONE
        }
        // Cerrojo huérfano: la sesión se borró desde la consola
        const orphan = !(await existsInTransaction(tx, doc(db, 'sessions', current)))
        if (orphan) {
          throw new AppError(
            `No se puede empezar: queda el cerrojo live/${uid} de una sesión que ya no existe. Pide al administrador que borre ese documento en la consola de Firestore.`,
          )
        }
        throw new AppError('Ya tienes una sesión en curso')
      }
      const sRef = doc(collection(db, 'sessions'))
      attempted.add(sRef.id)
      const data: SessionWrite = {
        owner: uid,
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
      }
      tx.set(sRef, data)
      tx.set(liveRef, { session_id: sRef.id } satisfies LiveDoc)
      return sRef.id
    })
  } catch (err) {
    if (err === ALREADY_DONE && resumed.id !== null) return resumed.id
    throw err
  }
  const doneMs = Date.now()
  // Lectura + commit ≈ dos idas y vueltas: el commit ocurre hacia el último cuarto del intervalo
  if (doneMs - clickMs <= 30_000) {
    setClockSample({ uid, sessionId: id, clientMs: Math.round(doneMs - (doneMs - clickMs) / 4) })
  }
  return id
}

/** Lo que escribe un STOP (para reconocerlo en un reintento). */
interface StopWrite {
  text: string
  reason: string
  fix?: { end: Date; reason: string }
}

function isSameStop(cur: SessionDoc, w: StopWrite): boolean {
  if (cur.end_time == null) return false
  if (cur.adjusted !== Boolean(w.fix) || cur.adjust_reason !== w.reason || cur.note !== w.text) return false
  return !w.fix || cur.end_time.toMillis() === w.fix.end.getTime()
}

/**
 * Reintento de un STOP cuyo cerrojo ya no apunta a la sesión que se intentó cerrar: o el intento
 * anterior se guardó (respuesta perdida) o la sesión se cerró desde otro dispositivo. Nunca escribe.
 */
async function resolveRetriedStop(tx: Transaction, sessionId: string, w: StopWrite): Promise<never> {
  const snap = await tx.get(doc(db, 'sessions', sessionId))
  const cur = snap.exists() ? (snap.data() as SessionDoc) : null
  if (cur && isSameStop(cur, w)) throw ALREADY_DONE
  if (cur && cur.end_time != null) {
    throw new AppError(
      `La sesión ya se había parado desde otro dispositivo (fin: ${formatDateTime(cur.end_time)}). Revisa el historial; si la hora no es correcta, anula la sesión y añade una entrada manual, y si falta tu nota, edítala desde el detalle.`,
    )
  }
  throw new AppError('La sesión en curso ha cambiado mientras se guardaba. Recarga la página y comprueba el historial.')
}

/**
 * STOP: guarda la revisión, cierra la sesión y borra live/{uid} en una sola transacción.
 * Sin `fix`: fin = hora del servidor. Con `fix`: fin tecleado (adjusted = true) + motivo.
 */
export async function stopSession(uid: string, note: string, fix?: { end: Date; reason: string }): Promise<void> {
  ensureOnline()
  assertSelf(uid)
  const text = cleanText(note)
  throwIfInvalid(validateNote(text, 'live'))
  const reason = fix ? cleanText(fix.reason) : ''
  const liveRef = doc(db, 'live', uid)
  // Sesión que un intento anterior de esta misma llamada llegó a enviar (el SDK reintenta)
  let attemptedId: string | null = null
  try {
    await runTransaction(db, async (tx) => {
      const live = await tx.get(liveRef)
      const liveId = live.exists() ? (live.data() as LiveDoc).session_id : null
      if (attemptedId !== null && liveId !== attemptedId) {
        await resolveRetriedStop(tx, attemptedId, { text, reason, fix })
      }
      if (liveId === null) {
        throw new AppError('No tienes ninguna sesión en curso (puede que ya se haya parado desde otro dispositivo).')
      }
      const sRef = doc(db, 'sessions', liveId)
      const snap = await tx.get(sRef)
      if (!snap.exists()) throw new AppError('No se encuentra la sesión en curso. Recarga la página.')
      const cur = snap.data() as SessionDoc
      if (cur.end_time != null || cur.voided) throw new AppError('Esta sesión ya estaba cerrada. Recarga la página.')

      const startMs = cur.start_time.toMillis()
      const nowMs = serverNowFor(uid, liveId, startMs)
      let end: Timestamp | FieldValue
      if (fix) {
        throwIfInvalid(validateAdjustedStop({ end: fix.end, reason }, { nowMs, start: cur.start_time.toDate() }))
        end = Timestamp.fromDate(fix.end)
      } else {
        if (nowMs - startMs > MAX_SESSION_MS) {
          throw new AppError(
            `Han pasado más de ${MAX_SESSION_HOURS} h desde que empezaste (${formatDateTime(startMs)}), así que no se puede parar con la hora actual. Indica a qué hora terminaste realmente ("Terminé antes / olvidé parar") y el motivo.`,
          )
        }
        end = serverTimestamp()
      }

      attemptedId = liveId
      writeRevision(tx, sRef, cur)
      tx.update(sRef, {
        end_time: end,
        adjusted: Boolean(fix),
        adjust_reason: reason,
        note: text,
        rev: cur.rev + 1,
        updated_at: serverTimestamp(),
      })
      tx.delete(liveRef)
    })
  } catch (err) {
    if (err === ALREADY_DONE) return
    if (errorCode(err) === 'permission-denied') throw new AppError(fix ? ADJUSTED_STOP_REJECTED : STOP_REJECTED)
    throw err
  }
}

/** Crea una entrada manual (valida con validateManual antes; lanza Error con el mensaje si no es válida). */
export async function addManualSession(uid: string, input: ManualInput): Promise<string> {
  ensureOnline()
  assertSelf(uid)
  // Se lee fuera de la transacción: un documento leído y no escrito se enviaría como "verify"
  const profileSnap = await getDoc(doc(db, 'users', uid))
  const profile = profileSnap.exists() ? (profileSnap.data() as UserDoc) : null
  if (!profile || profile.role !== 'student') throw new AppError('Solo la cuenta de estudiante puede registrar horas.')
  if (!profile.program_start) {
    throw new AppError(
      'Tu perfil no tiene fecha de inicio de prácticas (program_start). Pide al administrador que la configure.',
    )
  }

  const clean: ManualInput = {
    date: cleanText(input.date),
    time: manualTimeOf(input),
    minutes: input.minutes,
    note: cleanText(input.note),
  }
  throwIfInvalid(
    validateManual(clean, {
      nowMs: Date.now() + knownSkewMs,
      programStart: profile.program_start.toDate(),
      sessions: [],
    }),
  )
  const interval = manualInterval(clean)
  if (!interval) throw new AppError('La fecha, la hora o la duración no son válidas.')

  const sRef = doc(collection(db, 'sessions'))
  const data: SessionWrite = {
    owner: uid,
    method: 'manual',
    start_time: Timestamp.fromMillis(interval.start),
    end_time: Timestamp.fromMillis(interval.end),
    adjusted: false,
    adjust_reason: '',
    voided: false,
    void_reason: '',
    note: clean.note,
    rev: 0,
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  }
  let attempts = 0
  try {
    await runTransaction(db, async (tx) => {
      attempts++
      // En un reintento, el intento anterior pudo guardarse aunque se perdiera la respuesta:
      // volver a escribir duplicaría las horas (y las reglas lo rechazarían como modificación)
      if (attempts > 1 && (await existsInTransaction(tx, sRef))) throw ALREADY_DONE
      tx.set(sRef, data)
    })
  } catch (err) {
    if (err === ALREADY_DONE) return sRef.id
    if (errorCode(err) === 'permission-denied') throw new AppError(MANUAL_REJECTED)
    throw err
  }
  return sRef.id
}

async function readOwnSession(tx: Transaction, sRef: DocumentReference, uid: string): Promise<SessionDoc> {
  const snap = await tx.get(sRef)
  if (!snap.exists()) throw new AppError('La sesión no existe o ya no está disponible. Recarga la página.')
  const cur = snap.data() as SessionDoc
  if (cur.owner !== uid) throw new AppError('Solo puedes modificar tus propias sesiones.')
  return cur
}

/** Cambia solo la nota (con revisión). Si la nota no cambia, no escribe nada. */
export async function editSessionNote(sessionId: string, note: string): Promise<void> {
  ensureOnline()
  const uid = requireUid()
  const text = cleanText(note)
  const sRef = doc(db, 'sessions', sessionId)
  try {
    await runTransaction(db, async (tx) => {
      const cur = await readOwnSession(tx, sRef, uid)
      if (cur.voided) throw new AppError('No se puede editar la nota de una sesión anulada.')
      throwIfInvalid(validateNote(text, cur.method))
      if (text === cur.note) throw NO_CHANGE
      writeRevision(tx, sRef, cur)
      tx.update(sRef, { note: text, rev: cur.rev + 1, updated_at: serverTimestamp() })
    })
  } catch (err) {
    if (err === NO_CHANGE) return
    throw err
  }
}

/** Anula una sesión cerrada (irreversible, con revisión). */
export async function voidSession(sessionId: string, reason: string): Promise<void> {
  ensureOnline()
  const uid = requireUid()
  const text = cleanText(reason)
  throwIfInvalid(validateVoidReason(text))
  const sRef = doc(db, 'sessions', sessionId)
  let attempted = false
  try {
    await runTransaction(db, async (tx) => {
      const cur = await readOwnSession(tx, sRef, uid)
      if (cur.voided) {
        // Reintento de esta misma anulación, que ya se guardó (respuesta perdida)
        if (attempted && cur.void_reason === text) throw ALREADY_DONE
        throw new AppError('Esta sesión ya está anulada.')
      }
      if (cur.end_time == null) throw new AppError('No se puede anular una sesión en curso: párala primero.')
      attempted = true
      writeRevision(tx, sRef, cur)
      tx.update(sRef, { voided: true, void_reason: text, rev: cur.rev + 1, updated_at: serverTimestamp() })
    })
  } catch (err) {
    if (err === ALREADY_DONE) return
    throw err
  }
}

// ---------- Acciones de la supervisora ----------

export async function addComment(author: AppUser, session: Session, text: string): Promise<void> {
  if (author.role !== 'supervisor') throw new AppError('Solo la supervisora puede añadir comentarios.')
  ensureOnline()
  if (requireUid() !== author.uid) throw new AppError('Tu sesión ha cambiado. Recarga la página.')
  const body = cleanText(text)
  throwIfInvalid(validateComment(body))
  const cRef = doc(collection(db, 'comments'))
  const data: { [K in keyof CommentDoc]: CommentDoc[K] | FieldValue } = {
    session_id: session.id,
    session_owner: session.owner,
    author_uid: author.uid,
    text: body,
    created_at: serverTimestamp(),
  }
  let attempts = 0
  try {
    await runTransaction(db, async (tx) => {
      attempts++
      // Reintento: si el intento anterior se guardó, no se duplica el comentario
      if (attempts > 1 && (await existsInTransaction(tx, cRef))) throw ALREADY_DONE
      tx.set(cRef, data)
    })
  } catch (err) {
    if (err === ALREADY_DONE) return
    throw err
  }
}

// ---------- Errores ----------

const GENERIC_ERROR = 'Ha ocurrido un error inesperado. Vuelve a intentarlo y, si se repite, recarga la página.'
const NETWORK_ERROR = 'No se puede conectar con el servidor. Comprueba tu conexión a internet y vuelve a intentarlo.'
const BAD_LOGIN = 'Correo o contraseña incorrectos.'

const MESSAGES: Record<string, string> = {
  // Firestore
  'permission-denied':
    'El servidor ha rechazado la operación: no tienes permiso o los datos no cumplen las reglas (por ejemplo, una hora fuera de los límites o una sesión que ha cambiado mientras tanto). Recarga la página y vuelve a intentarlo.',
  unavailable: NETWORK_ERROR,
  'failed-precondition': 'Los datos han cambiado mientras se guardaba. Recarga la página y vuelve a intentarlo.',
  aborted: 'Otra operación ha modificado los mismos datos a la vez. Vuelve a intentarlo.',
  'resource-exhausted':
    'Se ha alcanzado el límite diario gratuito de Firebase. Vuelve a intentarlo más tarde (el límite se reinicia cada día hacia las 09:00).',
  'deadline-exceeded':
    'El servidor ha tardado demasiado en responder. Comprueba en el historial si el cambio se ha guardado antes de repetirlo.',
  'not-found': 'No se encuentra el dato. Puede que haya cambiado: recarga la página.',
  unauthenticated: 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  cancelled: 'La operación se ha cancelado. Vuelve a intentarlo.',
  'already-exists': 'Ese dato ya existe. Recarga la página.',
  'invalid-argument': 'Los datos enviados no son válidos. Recarga la página y vuelve a intentarlo.',
  // Auth
  'auth/invalid-credential': BAD_LOGIN,
  'auth/invalid-login-credentials': BAD_LOGIN,
  'auth/wrong-password': BAD_LOGIN,
  'auth/user-not-found': BAD_LOGIN,
  'auth/invalid-email': 'El correo no tiene un formato válido.',
  'auth/missing-email': 'Escribe tu correo.',
  'auth/missing-password': 'Escribe tu contraseña.',
  'auth/user-disabled': 'Esta cuenta está desactivada. Habla con el administrador.',
  'auth/too-many-requests':
    'Demasiados intentos seguidos. Espera unos minutos antes de volver a probar o usa "He olvidado mi contraseña".',
  'auth/network-request-failed': NETWORK_ERROR,
  'auth/weak-password': `La contraseña es demasiado débil: usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
  'auth/password-does-not-meet-requirements':
    'La contraseña no cumple los requisitos de seguridad del proyecto. Prueba con una más larga que combine letras y números.',
  'auth/requires-recent-login': 'Por seguridad, cierra sesión, vuelve a entrar y repite el cambio de contraseña.',
  'auth/user-token-expired': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  'auth/invalid-user-token': 'Tu sesión ha caducado. Vuelve a iniciar sesión.',
  'auth/quota-exceeded': 'Se ha alcanzado el límite de envíos de Firebase. Vuelve a intentarlo más tarde.',
  'auth/operation-not-allowed': 'El acceso con correo y contraseña no está activado en este proyecto de Firebase.',
  'auth/invalid-api-key': 'La configuración de Firebase no es válida (clave de API). Revisa el fichero .env.local.',
  'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    'La configuración de Firebase no es válida (clave de API). Revisa el fichero .env.local.',
}

/** Traduce errores de Firebase/red/validación a un mensaje en español para mostrar al usuario. */
export function friendlyError(e: unknown): string {
  if (e instanceof AppError) return e.message
  const code = errorCode(e)
  if (code !== null) {
    const known = MESSAGES[code]
    if (known) return known
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return NETWORK_ERROR
    return code.startsWith('auth/')
      ? 'No se ha podido completar el acceso. Vuelve a intentarlo dentro de un momento.'
      : GENERIC_ERROR
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return NETWORK_ERROR
  if (e instanceof TypeError && /fetch|network/i.test(e.message)) return NETWORK_ERROR
  // Errores propios lanzados con `new Error('mensaje')` (validación, UI)
  if (e instanceof Error && e.name === 'Error' && e.constructor === Error && e.message.trim()) return e.message
  return GENERIC_ERROR
}
