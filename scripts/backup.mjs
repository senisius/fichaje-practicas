// @ts-check
// Copia de seguridad de Firestore con la cuenta técnica 'backup' (solo lectura + meta/backup).
// Usa solo dependencias de producción (SDK cliente 'firebase'), para que el workflow pueda
// instalar con `npm ci --omit=dev`.
//
// Uso:
//   Emuladores:     npm run backup -- --emulator   (backup@demo.test / demo-backup salvo que se indiquen)
//   Proyecto real:  lo ejecuta el workflow .github/workflows/backup.yml con las variables
//                   FIREBASE_API_KEY, FIREBASE_PROJECT_ID, BACKUP_EMAIL y BACKUP_PASSWORD
//                   (FIREBASE_AUTH_DOMAIN es opcional: por defecto <proyecto>.firebaseapp.com).
//                   A mano, ver docs/DESPLIEGUE.md (13.6): el JSON queda sin cifrar.
//
// Opciones:
//   --no-mark     vuelca la copia pero no toca meta/backup; escribe docs=<total> en GITHUB_OUTPUT.
//                 El workflow marca después, cuando la copia cifrada ya está subida.
//   --mark-only   no vuelca nada: solo marca meta/backup con docs = BACKUP_DOCS (entero >= 0).
//
// Resultado: backups/fichaje-backup-<YYYY-MM-DDTHH-mm-ss-SSSZ>.json y (salvo --no-mark) meta/backup
// actualizado. Sale con código distinto de 0 si algo falla. Nunca imprime la API key, el email ni la
// contraseña.
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { deleteApp, initializeApp, setLogLevel } from 'firebase/app'
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from 'firebase/auth'
import {
  Bytes,
  DocumentReference,
  GeoPoint,
  Timestamp,
  collection,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  getDocsFromServer,
  initializeFirestore,
  memoryLocalCache,
  serverTimestamp,
  setDoc,
  terminate,
} from 'firebase/firestore'

const EMULATOR_PROJECT_ID = 'demo-fichaje'
const EMULATOR_FIRESTORE_PORT = 8181
const EMULATOR_AUTH_PORT = 9099
/** Tiempo máximo total antes de abortar (el workflow tiene además su propio timeout). */
const WATCHDOG_MS = 5 * 60_000
/** Lecturas de revisiones en paralelo. */
const REVISION_CONCURRENCY = 8

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BACKUP_DIR = path.join(ROOT, 'backups')
const USAGE = 'Uso: npm run backup [-- [--emulator] [--no-mark | --mark-only]]'
const FLAGS = ['--emulator', '--no-mark', '--mark-only']

class UsageError extends Error {}

/** Valores que nunca deben aparecer en la salida. @type {string[]} */
const secrets = []
/** @param {string} text */
const redact = (text) => secrets.reduce((t, s) => (s.length >= 4 ? t.split(s).join('***') : t), text)

/** @param {string} name */
const env = (name) => (process.env[name] ?? '').trim()

function loadConfig() {
  const args = process.argv.slice(2)
  const unknown = args.filter((a) => !FLAGS.includes(a))
  if (unknown.length > 0) throw new UsageError(`Argumento no reconocido: ${unknown.join(' ')}`)
  const emulator = args.includes('--emulator')
  const noMark = args.includes('--no-mark')
  const markOnly = args.includes('--mark-only')
  if (noMark && markOnly) throw new UsageError('--no-mark y --mark-only no se pueden usar a la vez.')
  /** @type {number | null} */
  let markDocs = null
  if (markOnly) {
    const raw = env('BACKUP_DOCS')
    markDocs = /^\d+$/.test(raw) ? Number(raw) : Number.NaN
    if (!Number.isSafeInteger(markDocs)) {
      throw new UsageError(
        `--mark-only necesita BACKUP_DOCS con el número de documentos copiados (entero >= 0); recibido: "${raw}".`,
      )
    }
  }
  const mode = { noMark, markOnly, markDocs }
  // La contraseña no se recorta (podría contener espacios); solo se quita un salto de línea final.
  const password = (process.env.BACKUP_PASSWORD ?? '').replace(/[\r\n]+$/, '')

  if (emulator) {
    return {
      ...mode,
      emulator,
      apiKey: 'demo-api-key',
      projectId: EMULATOR_PROJECT_ID,
      authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
      email: env('BACKUP_EMAIL') || 'backup@demo.test',
      password: password || 'demo-backup',
    }
  }

  const missing = ['FIREBASE_API_KEY', 'FIREBASE_PROJECT_ID', 'BACKUP_EMAIL'].filter((k) => !env(k))
  if (!password) missing.push('BACKUP_PASSWORD')
  if (missing.length > 0) {
    throw new UsageError(`Faltan variables de entorno: ${missing.join(', ')}. `
      + 'Para probar en local contra los emuladores usa --emulator.')
  }
  const projectId = env('FIREBASE_PROJECT_ID')
  const cfg = {
    ...mode,
    emulator,
    apiKey: env('FIREBASE_API_KEY'),
    projectId,
    authDomain: env('FIREBASE_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
    email: env('BACKUP_EMAIL'),
    password,
  }
  secrets.push(cfg.apiKey, cfg.email, cfg.password)
  return cfg
}

/**
 * Convierte los valores de Firestore a JSON. Los Timestamp se guardan con ISO (legible) y
 * seconds/nanoseconds (exacto) para poder restaurarlos sin perder precisión.
 * @param {unknown} v
 * @returns {unknown}
 */
function toJson(v) {
  if (v === null || typeof v !== 'object') return v
  if (v instanceof Timestamp) {
    return { __type: 'timestamp', iso: v.toDate().toISOString(), seconds: v.seconds, nanoseconds: v.nanoseconds }
  }
  if (v instanceof GeoPoint) return { __type: 'geopoint', latitude: v.latitude, longitude: v.longitude }
  if (v instanceof DocumentReference) return { __type: 'reference', path: v.path }
  if (v instanceof Bytes) return { __type: 'bytes', base64: v.toBase64() }
  if (Array.isArray(v)) return v.map(toJson)
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, toJson(x)]))
}

/** @param {import('firebase/firestore').DocumentSnapshot} snap */
const entry = (snap) => ({ id: snap.id, data: toJson(snap.data()) })

/**
 * Ejecuta fn sobre cada elemento con un máximo de `limit` en paralelo, conservando el orden.
 * @template T, R
 * @param {T[]} items @param {number} limit @param {(item: T) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
async function mapPool(items, limit, fn) {
  /** @type {R[]} */
  const out = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}

/** Mensaje claro en español para los fallos más habituales. @param {unknown} e */
function describeError(e) {
  if (e instanceof UsageError) return `${e.message}\n${USAGE}`
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : ''
  const message = e instanceof Error ? e.message : String(e)
  const blocked = /are-blocked|are blocked|API_KEY_HTTP_REFERRER_BLOCKED/i.test(`${code} ${message}`)
  if (blocked) {
    return 'La API key rechaza la petición. La clave de backup no debe tener restricción de sitios web '
      + 'y debe permitir Identity Toolkit API, Token Service API y Cloud Firestore API.'
  }
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
    case 'auth/invalid-email':
      return 'No se pudo iniciar sesión con la cuenta de backup: revisa BACKUP_EMAIL y BACKUP_PASSWORD.'
    case 'auth/user-disabled':
      return 'La cuenta de backup está deshabilitada en Authentication.'
    case 'auth/too-many-requests':
      return 'Demasiados intentos de inicio de sesión; espera un rato y vuelve a probar.'
    case 'auth/network-request-failed':
      return 'Sin conexión con Firebase Authentication (red o emulador de Auth no disponible).'
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
      return 'La API key no es válida (FIREBASE_API_KEY; en GitHub, el secret FIREBASE_API_KEY_BACKUP).'
    case 'permission-denied':
      return 'Permiso denegado en Firestore: comprueba que existe users/{uid} de la cuenta de backup con '
        + 'role "backup", que las reglas están desplegadas y que FIREBASE_PROJECT_ID es el proyecto de la API key. '
        + `(${redact(message)})`
    case 'unauthenticated':
      return 'Firestore no acepta la sesión: revisa que FIREBASE_PROJECT_ID corresponde al proyecto de la API key.'
    case 'unavailable':
      return 'No se puede conectar con Firestore (red, proyecto o emulador no disponible).'
    case 'resource-exhausted':
      return 'Se ha agotado la cuota diaria gratuita de Firestore; vuelve a intentarlo mañana.'
    case 'not-found':
      return 'No se encuentra la base de datos de Firestore: revisa FIREBASE_PROJECT_ID.'
    default:
      return redact(code ? `${code}: ${message}` : message)
  }
}

/**
 * Nombre de la copia con milisegundos, para que dos copias del mismo segundo no coincidan:
 * fichaje-backup-2026-09-16T10-00-00-123Z
 * @param {Date} d
 */
function backupName(d) {
  return `fichaje-backup-${d.toISOString().slice(0, 23).replace(/[:.]/g, '-')}Z`
}

/**
 * Escribe la copia en un fichero nuevo. Nunca sobrescribe (flag 'wx'): si otra copia tomó el mismo
 * nombre en el mismo milisegundo, prueba con el milisegundo siguiente.
 * @param {Date} at @param {string} content
 * @returns {Promise<{ name: string, file: string }>}
 */
async function writeNewBackup(at, content) {
  for (let offset = 0; offset < 1000; offset++) {
    const name = backupName(new Date(at.getTime() + offset))
    const file = path.join(BACKUP_DIR, `${name}.json`)
    try {
      await writeFile(file, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      return { name, file }
    } catch (e) {
      if (!(typeof e === 'object' && e !== null && 'code' in e && e.code === 'EEXIST')) throw e
    }
  }
  throw new Error('No se ha encontrado un nombre libre para la copia en backups/.')
}

async function main() {
  const cfg = loadConfig()
  setLogLevel('error')

  const app = initializeApp({ apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId }, 'backup')
  const auth = getAuth(app)
  const db = initializeFirestore(app, { localCache: memoryLocalCache() })
  if (cfg.emulator) {
    connectAuthEmulator(auth, `http://127.0.0.1:${EMULATOR_AUTH_PORT}`, { disableWarnings: true })
    connectFirestoreEmulator(db, '127.0.0.1', EMULATOR_FIRESTORE_PORT)
  }

  try {
    console.log(`Backup de Firestore (${cfg.emulator ? `emuladores, proyecto ${cfg.projectId}` : 'proyecto real'})`)
    const { user } = await signInWithEmailAndPassword(auth, cfg.email, cfg.password)
    console.log('  Sesión iniciada con la cuenta de backup.')

    if (cfg.markOnly) {
      // Paso final del workflow: la copia cifrada ya está subida
      await setDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp(), docs: cfg.markDocs })
      console.log(`  meta/backup actualizado (${cfg.markDocs} documentos).`)
      return
    }

    // *FromServer: si no hay conexión fallan en vez de devolver una caché vacía.
    const users = (await getDocsFromServer(collection(db, 'users'))).docs.map(entry)
    const me = users.find((u) => u.id === user.uid)
    const role = me && typeof me.data === 'object' && me.data !== null && 'role' in me.data ? me.data.role : undefined
    if (role !== 'backup') {
      throw new Error('La cuenta de backup no tiene un documento users/{uid} con role "backup".')
    }

    const sessionDocs = (await getDocsFromServer(collection(db, 'sessions'))).docs
    const sessions = await mapPool(sessionDocs, REVISION_CONCURRENCY, async (s) => {
      const revs = (await getDocsFromServer(collection(db, 'sessions', s.id, 'revisions'))).docs
        .sort((a, b) => Number(a.id) - Number(b.id))
        .map(entry)
      return { ...entry(s), revisions: revs }
    })
    const live = (await getDocsFromServer(collection(db, 'live'))).docs.map(entry)
    const comments = (await getDocsFromServer(collection(db, 'comments'))).docs.map(entry)
    // Las reglas solo permiten leer meta/backup (no listar la colección meta).
    const metaSnap = await getDocFromServer(doc(db, 'meta', 'backup'))
    const meta = metaSnap.exists() ? [entry(metaSnap)] : []

    const revisionCount = sessions.reduce((n, s) => n + s.revisions.length, 0)
    const counts = {
      users: users.length,
      sessions: sessions.length,
      revisions: revisionCount,
      live: live.length,
      comments: comments.length,
      meta: meta.length,
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0)

    const exportedAt = new Date()
    const payload = {
      format: 'fichaje-practicas-backup',
      version: 1,
      exported_at: exportedAt.toISOString(),
      source: cfg.emulator ? 'emulator' : 'firebase',
      project_id: cfg.projectId,
      timestamp_encoding: '{ __type: "timestamp", iso, seconds, nanoseconds }',
      counts,
      total_docs: total,
      collections: { users, sessions, live, comments, meta },
    }
    await mkdir(BACKUP_DIR, { recursive: true })
    const { name, file } = await writeNewBackup(exportedAt, `${JSON.stringify(payload, null, 2)}\n`)
    const { size } = await stat(file)
    const rel = path.relative(process.cwd(), file).split(path.sep).join('/')

    // Marca de backup para el indicador de la app (last_backup_at lo pone el servidor). Con --no-mark
    // la pone el workflow al final, solo si la copia cifrada se ha subido.
    if (!cfg.noMark) await setDoc(doc(db, 'meta', 'backup'), { last_backup_at: serverTimestamp(), docs: total })

    if (process.env.GITHUB_OUTPUT) {
      await appendFile(process.env.GITHUB_OUTPUT, `file=${rel}\nname=${name}\ndocs=${total}\n`)
    }

    console.log(`  Copia guardada en ${rel} (${(size / 1024).toFixed(1)} KB)`)
    console.log(`  users: ${counts.users} · sessions: ${counts.sessions} (revisiones: ${counts.revisions})`
      + ` · live: ${counts.live} · comments: ${counts.comments} · meta: ${counts.meta}`)
    console.log(`  Total: ${total} documentos. `
      + (cfg.noMark ? 'meta/backup sin tocar (--no-mark).' : 'meta/backup actualizado.'))
  } finally {
    await signOut(auth).catch(() => {})
    await terminate(db).catch(() => {})
    await deleteApp(app).catch(() => {})
  }
}

const watchdog = setTimeout(() => {
  console.error(`\nError: el backup no ha terminado en ${WATCHDOG_MS / 60_000} minutos; se aborta.`)
  process.exit(1)
}, WATCHDOG_MS)
watchdog.unref()

main()
  .then(() => {
    process.exitCode = 0
  })
  .catch((e) => {
    console.error(`\nError en el backup: ${describeError(e)}`)
    process.exitCode = e instanceof UsageError ? 2 : 1
  })
  .finally(() => {
    clearTimeout(watchdog)
    // Red de seguridad: si algún recurso del SDK siguiera abierto, el proceso termina igualmente.
    setTimeout(() => process.exit(), 3000).unref()
  })
