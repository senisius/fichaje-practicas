// @ts-check
// Rellena los EMULADORES locales (Auth 9099, Firestore 8181, proyecto demo-fichaje) con datos de ejemplo.
// Nunca toca un proyecto real: fija las variables de emulador antes de cargar firebase-admin.
//
// Uso:  npm run seed              → borra todo y crea cuentas, perfiles, ~25 sesiones y comentarios
//       npm run seed -- --open    → además, una sesión en vivo abierta desde hace 2 h
//
// El Admin SDK se salta las reglas, así que este script garantiza por su cuenta que los datos
// cumplen docs/CONTRATO.md (12 claves, rev y revisiones coherentes, límites de las manuales).
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const PROJECT_ID = 'demo-fichaje'
const FIRESTORE_HOST = '127.0.0.1:8181'
const AUTH_HOST = '127.0.0.1:9099'

process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST
process.env.GCLOUD_PROJECT = PROJECT_ID
// Sin credenciales reales en este proceso, por si acaso.
delete process.env.GOOGLE_APPLICATION_CREDENTIALS
// Evita que firebase-admin busque el servidor de metadatos de Google Cloud (y avise al no encontrarlo).
process.env.METADATA_SERVER_DETECTION = 'none'

const TZ = 'Europe/Madrid'
const MIN = 60_000
const H = 3_600_000
const DAY = 24 * H

const USAGE = 'Uso: npm run seed [-- --open]'
const args = process.argv.slice(2)
if (args.includes('--help') || args.includes('-h')) {
  console.log(USAGE)
  process.exit(0)
}
const unknown = args.filter((a) => a !== '--open')
if (unknown.length > 0) {
  console.error(`Argumento no reconocido: ${unknown.join(' ')}\n${USAGE}`)
  process.exit(2)
}
const WITH_OPEN = args.includes('--open')

// Cuentas de docs/CONTRATO.md (solo existen en el emulador).
const ACCOUNTS = {
  student: { uid: 'uid-estudiante', email: 'estudiante@demo.test', password: 'demo-estudiante', name: 'Estudiante Demo' },
  supervisor: { uid: 'uid-profesora', email: 'profesora@demo.test', password: 'demo-profesora', name: 'Profesora Demo' },
  backup: { uid: 'uid-backup', email: 'backup@demo.test', password: 'demo-backup', name: 'Copia de seguridad' },
  noProfile: { uid: 'uid-sinperfil', email: 'sinperfil@demo.test', password: 'demo-sinperfil', name: 'Sin perfil' },
}
const STUDENT = ACCOUNTS.student.uid
const SUPERVISOR = ACCOUNTS.supervisor.uid

// ---------- Fechas (siempre en hora de Madrid, sin depender de la zona del equipo) ----------

const NOW = Date.now()
/** @param {number} ms */
const dateKey = (ms) => formatInTimeZone(ms, TZ, 'yyyy-MM-dd')
/** Instante UTC (ms) de una fecha y hora civiles de Madrid. @param {string} key @param {string} time "HH:mm" o "HH:mm:ss" */
const at = (key, time) => fromZonedTime(`${key}T${time.length === 5 ? `${time}:00` : time}`, TZ).getTime()
/** @param {string} key @param {number} n */
const addDays = (key, n) => {
  const d = new Date(`${key}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
/** 0 = domingo … 6 = sábado. @param {string} key */
const weekday = (key) => new Date(`${key}T12:00:00Z`).getUTCDay()

const TODAY = dateKey(NOW)
const PROGRAM_START = at(addDays(TODAY, -60), '00:00')

// Días laborables de las últimas 8 semanas, sin hoy (así nada queda en el futuro).
/** @type {string[]} */
const WORKDAYS = []
for (let i = 56; i >= 1; i--) {
  const key = addDays(TODAY, -i)
  const wd = weekday(key)
  if (wd >= 1 && wd <= 5) WORKDAYS.push(key)
}
/** @param {number} i */
const wday = (i) => {
  const key = WORKDAYS[i]
  if (!key) throw new Error(`No hay día laborable ${i}`)
  return key
}

// ---------- Modelo de sesión con historial ----------

/**
 * @typedef {{
 *   owner: string, method: 'live' | 'manual', start_time: number, end_time: number | null,
 *   adjusted: boolean, adjust_reason: string, voided: boolean, void_reason: string,
 *   note: string, rev: number, created_at: number, updated_at: number
 * }} State
 * @typedef {{ id: string, label: string, state: State, revisions: { id: string, before: State, at: number }[] }} SeedSession
 * @typedef {{ session: SeedSession, text: string, created_at: number }} SeedComment
 */

const SESSION_KEYS = ['owner', 'method', 'start_time', 'end_time', 'adjusted', 'adjust_reason',
  'voided', 'void_reason', 'note', 'rev', 'created_at', 'updated_at']

/** @type {SeedSession[]} */
const sessions = []
/** @type {SeedComment[]} */
const comments = []

/**
 * @param {'live' | 'manual'} method @param {number} start @param {number | null} end
 * @param {string} note @param {number} createdAt
 * @returns {State}
 */
function initialState(method, start, end, note, createdAt) {
  return {
    owner: STUDENT, method, start_time: start, end_time: end,
    adjusted: false, adjust_reason: '', voided: false, void_reason: '',
    note, rev: 0, created_at: createdAt, updated_at: createdAt,
  }
}

/**
 * Aplica una transición: guarda la revisión con el estado anterior, rev + 1 y updated_at = t.
 * @param {SeedSession} s @param {number} t @param {Partial<State>} patch
 */
function change(s, t, patch) {
  const before = { ...s.state }
  s.revisions.push({ id: String(before.rev), before, at: t })
  s.state = { ...before, ...patch, rev: before.rev + 1, updated_at: t }
}

/** START (+ STOP normal si se indica el fin). @param {string} label @param {string} key @param {string} from @param {string | null} to @param {string} note */
function live(label, key, from, to, note) {
  const start = at(key, from)
  /** @type {SeedSession} */
  const s = { id: '', label, state: initialState('live', start, null, '', start), revisions: [] }
  if (to !== null) {
    const end = at(key, to)
    change(s, end, { end_time: end, adjusted: false, adjust_reason: '', note })
  }
  sessions.push(s)
  return s
}

/** STOP ajustado: fin tecleado `end`, parado de verdad en `stoppedAt`. @param {SeedSession} s @param {number} end @param {number} stoppedAt @param {string} reason @param {string} note */
function adjustStop(s, end, stoppedAt, reason, note) {
  change(s, stoppedAt, { end_time: end, adjusted: true, adjust_reason: reason, note })
}

/** Entrada manual. @param {string} label @param {string} key @param {string} from @param {number} minutes @param {string} note @param {number} createdAt */
function manual(label, key, from, minutes, note, createdAt) {
  const start = at(key, from)
  /** @type {SeedSession} */
  const s = { id: '', label, state: initialState('manual', start, start + minutes * MIN, note, createdAt), revisions: [] }
  sessions.push(s)
  return s
}

/** @param {SeedSession} session @param {number} createdAt @param {string} text */
function comment(session, createdAt, text) {
  comments.push({ session, text, created_at: Math.min(createdAt, NOW - MIN) })
}

// ---------- Datos de ejemplo (índices sobre WORKDAYS, del más antiguo al más reciente) ----------

live('normal', wday(0), '09:05:12', '13:40:48', 'Acogida, presentación del equipo y configuración del portátil.')
live('normal', wday(1), '08:58:31', '14:02:09', 'Lectura de la documentación interna y del plan de prácticas.')
manual('manual', wday(2), '09:00', 300, 'Formación en línea sobre protección de datos (desde casa).', at(wday(2), '20:15:32'))
live('normal', wday(4), '09:10:05', '14:15:40', 'Revisión de expedientes con la tutora de la empresa.')

// Solape: manual de 12:00 a 15:00 sobre un fichaje de 09:00 a 13:30.
live('solapada (live)', wday(5), '09:00:44', '13:30:02', 'Preparación de la reunión de seguimiento.')
const overlap = manual('solapada (manual)', wday(5), '12:00', 180, 'Reunión de seguimiento y redacción del acta.', at(wday(5), '19:40:11'))
comment(overlap, at(addDays(wday(5), 1), '10:12:30'),
  'Esta entrada manual se solapa con el fichaje de la mañana (12:00–13:30). ¿Puedes revisarla?')

live('normal', wday(7), '09:03:27', '14:31:15', 'Análisis de datos de la encuesta de satisfacción.')

// Olvidó parar: lo cierra al día siguiente a las 08:47 con fin 14:30.
const forgot = live('fin ajustado (olvidó parar)', wday(8), '09:12:18', null, '')
adjustStop(forgot, at(wday(8), '14:30'), at(addDays(wday(8), 1), '08:47:05'),
  'Olvidé parar al salir; terminé a las 14:30.', 'Tabulación de resultados de la encuesta.')
comment(forgot, at(addDays(wday(8), 1), '11:05:00'), 'De acuerdo, gracias por indicar la hora real de salida.')

// Nota editada al día siguiente (rev 2: parada + edición).
const edited = live('nota editada', wday(9), '09:00:09', '13:55:37', 'Informe de resultados.')
change(edited, at(addDays(wday(9), 1), '08:30:21'), { note: 'Informe de resultados (primer borrador) y revisión de gráficos.' })

// Día de más de 10 h: 5 h 50 min + 4 h 40 min.
live('día > 10 h (mañana)', wday(11), '08:15:03', '14:05:26', 'Preparación de la jornada de puertas abiertas.')
const longDay = live('día > 10 h (tarde)', wday(11), '15:00:14', '19:40:52', 'Jornada de puertas abiertas: atención a visitantes.')
comment(longDay, at(addDays(wday(11), 1), '09:45:00'), 'Jornada muy larga; recuerda compensarlo otro día.')

live('normal', wday(12), '10:00:40', '14:00:18', 'Recogida de material y memoria de la jornada.')

// Anulada y registrada de nuevo con la duración correcta.
const voided = manual('anulada', wday(14), '09:00', 240, 'Trabajo de documentación desde casa.', at(wday(14), '18:00:07'))
change(voided, at(wday(14), '18:20:45'), { voided: true, void_reason: 'Duración equivocada: puse 4 h y fueron 3 h; la registro de nuevo.' })
comment(voided, at(addDays(wday(14), 1), '10:30:00'), 'Correcto: mejor anularla y volver a registrarla.')
manual('manual (sustituye a la anulada)', wday(14), '09:00', 180, 'Trabajo de documentación desde casa (corregido).', at(wday(14), '18:22:10'))

live('normal', wday(15), '09:07:55', '14:12:03', 'Actualización de la base de datos de contactos.')
live('normal', wday(18), '09:04:16', '14:20:49', 'Preparación de materiales para el taller.')

// Terminó antes y paró por la tarde.
const early = live('fin ajustado (terminó antes)', wday(19), '08:55:02', null, '')
adjustStop(early, at(wday(19), '13:00'), at(wday(19), '15:40:33'),
  'Salí a las 13:00 por una cita médica y no paré el fichaje hasta la tarde.', 'Taller con usuarios (primera parte).')

live('normal', wday(21), '09:00:25', '14:00:58', 'Taller con usuarios (segunda parte) y valoración.')

// Registrada 5 días después de terminar.
const lateEnd = at(wday(22), '14:30')
const late = manual('registrada 5 días tarde', wday(22), '09:00', 330,
  'Visita a un centro colaborador con la tutora (sin acceso al ordenador).', lateEnd + 5 * DAY + 2 * H + 13_000)
comment(late, late.state.created_at + 18 * H,
  'La registraste 5 días después; la próxima vez intenta apuntarla el mismo día.')

live('normal', wday(24), '09:10:37', '14:05:12', 'Revisión de la memoria de prácticas con la tutora.')
const good = live('normal', wday(28), '09:00:03', '14:10:44', 'Informe final de la encuesta.')
comment(good, at(addDays(wday(28), 1), '12:00:00'), 'Buen trabajo con el informe final de la encuesta.')
manual('manual', wday(31), '09:00', 270, 'Curso en línea de herramientas ofimáticas.', at(wday(31), '21:00:40'))
live('normal', wday(33), '09:05:50', '14:00:27', 'Apoyo en la organización del archivo.')
live('normal', wday(35), '09:00:12', '13:30:39', 'Preparación de la presentación trimestral.')
live('normal', wday(37), '09:03:44', '14:15:20', 'Presentación trimestral y recogida de propuestas.')
live('normal', wday(39), '09:00:31', '13:50:05', 'Seguimiento de propuestas y planificación de la semana.')

// Opcional: sesión en vivo abierta desde hace 2 h (con su cerrojo live/{uid}).
/** @type {SeedSession | null} */
const openSession = WITH_OPEN
  ? (() => {
      const start = NOW - 2 * H
      /** @type {SeedSession} */
      const s = { id: '', label: 'EN CURSO', state: initialState('live', start, null, '', start), revisions: [] }
      sessions.push(s)
      return s
    })()
  : null

// ---------- Comprobaciones de coherencia (CONTRATO.md) ----------

/** @param {boolean} ok @param {string} msg */
function assert(ok, msg) {
  if (!ok) throw new Error(`Datos de seed incoherentes: ${msg}`)
}

/** @param {SeedSession} s */
function checkSession(s) {
  const st = s.state
  const where = `${s.label} (${dateKey(st.start_time)})`
  assert(Object.keys(st).join() === SESSION_KEYS.join(), `${where}: claves distintas de las 12 del contrato`)
  assert(st.start_time >= PROGRAM_START, `${where}: empieza antes de program_start`)
  assert(st.created_at <= NOW && st.updated_at <= NOW, `${where}: fechas en el futuro`)
  assert(st.updated_at >= st.created_at, `${where}: updated_at < created_at`)
  assert(st.rev === s.revisions.length, `${where}: rev (${st.rev}) no coincide con las revisiones (${s.revisions.length})`)
  s.revisions.forEach((r, i) => {
    assert(r.id === String(i) && r.before.rev === i, `${where}: revisión ${i} mal numerada`)
    const next = s.revisions[i + 1]
    const after = next ? next.before : st
    assert(after.updated_at === r.at, `${where}: revisión ${i} con 'at' distinto del updated_at del cambio`)
  })
  if (st.end_time !== null) {
    const dur = st.end_time - st.start_time
    assert(dur > 0 && dur <= 16 * H, `${where}: duración fuera de (0, 16 h]`)
    assert(st.end_time <= NOW, `${where}: termina en el futuro`)
  }
  if (st.adjusted) {
    assert(st.adjust_reason.length >= 10 && st.adjust_reason.length <= 500, `${where}: motivo de ajuste`)
  } else {
    assert(st.adjust_reason === '', `${where}: adjust_reason sin ajuste`)
  }
  if (st.voided) {
    assert(st.end_time !== null && st.void_reason.length >= 10 && st.void_reason.length <= 500, `${where}: anulación`)
  } else {
    assert(st.void_reason === '', `${where}: void_reason sin anular`)
  }
  assert(st.note.length <= 2000, `${where}: nota demasiado larga`)
  if (st.method === 'live') {
    assert(st.start_time === st.created_at, `${where}: live con start_time != created_at`)
    const first = s.revisions[0]
    if (st.end_time === null) {
      assert(st.rev === 0 && st.note === '', `${where}: sesión abierta con cambios`)
    } else {
      assert(first !== undefined && first.before.end_time === null && first.before.rev === 0, `${where}: live cerrada sin revisión 0 abierta`)
      if (!st.adjusted) assert(st.end_time === first.at, `${where}: parada normal con fin distinto de la hora del servidor`)
      else assert(st.end_time < first.at, `${where}: fin ajustado no anterior a la parada`)
    }
  } else {
    assert(st.end_time !== null && st.created_at >= st.end_time, `${where}: manual registrada antes de terminar`)
    assert(st.created_at <= st.start_time + 31 * DAY, `${where}: manual con más de 31 días de retraso`)
    assert(st.note.trim().length >= 5, `${where}: manual con nota < 5`)
  }
}

sessions.forEach(checkSession)
assert(sessions.filter((s) => s.state.end_time === null).length === (WITH_OPEN ? 1 : 0), 'sesiones abiertas')
for (const c of comments) {
  assert(c.created_at >= c.session.state.created_at, `comentario anterior a su sesión (${c.session.label})`)
  assert(c.text.length >= 1 && c.text.length <= 2000, 'longitud de comentario')
}

// ---------- Emuladores ----------

async function clearEmulators() {
  const targets = [
    { name: 'Firestore', url: `http://${FIRESTORE_HOST}/emulator/v1/projects/${PROJECT_ID}/databases/(default)/documents` },
    { name: 'Auth', url: `http://${AUTH_HOST}/emulator/v1/projects/${PROJECT_ID}/accounts` },
  ]
  for (const t of targets) {
    /** @type {Response} */
    let res
    try {
      res = await fetch(t.url, { method: 'DELETE' })
    } catch {
      throw new Error(`No se puede conectar con el emulador de ${t.name} (${new URL(t.url).host}). `
        + '¿Has arrancado "npm run emulators" en otra terminal?')
    }
    if (!res.ok) throw new Error(`El emulador de ${t.name} respondió ${res.status} al borrar los datos.`)
  }
}

async function main() {
  await clearEmulators()

  // Se cargan después de fijar las variables de entorno de los emuladores.
  const { deleteApp, initializeApp } = await import('firebase-admin/app')
  const { getAuth } = await import('firebase-admin/auth')
  const { Timestamp, getFirestore } = await import('firebase-admin/firestore')

  const app = initializeApp({ projectId: PROJECT_ID }, 'seed')
  try {
    const auth = getAuth(app)
    for (const a of Object.values(ACCOUNTS)) {
      await auth.createUser({ uid: a.uid, email: a.email, password: a.password, displayName: a.name, emailVerified: true })
    }

    const db = getFirestore(app)
    /** @param {number} ms */
    const ts = (ms) => Timestamp.fromMillis(ms)
    /** @param {State} st */
    const toDoc = (st) => ({
      ...st,
      start_time: ts(st.start_time),
      end_time: st.end_time === null ? null : ts(st.end_time),
      created_at: ts(st.created_at),
      updated_at: ts(st.updated_at),
    })

    const batch = db.batch()
    batch.set(db.doc(`users/${ACCOUNTS.student.uid}`), {
      role: 'student',
      name: ACCOUNTS.student.name,
      email: ACCOUNTS.student.email,
      target_hours: 298,
      program_start: ts(PROGRAM_START),
    })
    batch.set(db.doc(`users/${ACCOUNTS.supervisor.uid}`), {
      role: 'supervisor', name: ACCOUNTS.supervisor.name, email: ACCOUNTS.supervisor.email,
    })
    batch.set(db.doc(`users/${ACCOUNTS.backup.uid}`), {
      role: 'backup', name: ACCOUNTS.backup.name, email: ACCOUNTS.backup.email,
    })
    // uid-sinperfil: sin documento users a propósito.

    for (const s of sessions) {
      const ref = db.collection('sessions').doc()
      s.id = ref.id
      batch.set(ref, toDoc(s.state))
      for (const r of s.revisions) {
        batch.set(ref.collection('revisions').doc(r.id), { before: toDoc(r.before), at: ts(r.at) })
      }
    }
    if (openSession) batch.set(db.doc(`live/${STUDENT}`), { session_id: openSession.id })

    for (const c of comments) {
      batch.set(db.collection('comments').doc(), {
        session_id: c.session.id,
        session_owner: c.session.state.owner,
        author_uid: SUPERVISOR,
        text: c.text,
        created_at: ts(c.created_at),
      })
    }

    // Último backup "hace 3 días", con el nº de documentos que existían entonces.
    const backupAt = NOW - 3 * DAY
    const docsThen = 3
      + sessions.filter((s) => s.state.created_at <= backupAt).length
      + sessions.flatMap((s) => s.revisions).filter((r) => r.at <= backupAt).length
      + comments.filter((c) => c.created_at <= backupAt).length
    batch.set(db.doc('meta/backup'), { last_backup_at: ts(backupAt), docs: docsThen })

    await batch.commit()
    printSummary(backupAt)
  } finally {
    await deleteApp(app)
  }
}

/** @param {number} backupAt */
function printSummary(backupAt) {
  const fmt = (/** @type {number} */ ms) => formatInTimeZone(ms, TZ, 'dd/MM/yyyy HH:mm')
  const revCount = sessions.reduce((n, s) => n + s.revisions.length, 0)
  const validMs = sessions
    .filter((s) => s.state.end_time !== null && !s.state.voided)
    .reduce((n, s) => n + /** @type {number} */ (s.state.end_time) - s.state.start_time, 0)
  const lines = [
    '',
    `Emuladores rellenados (proyecto ${PROJECT_ID}).`,
    `  Sesiones: ${sessions.length} (revisiones: ${revCount}) · comentarios: ${comments.length} · válido: ${Math.floor(validMs / H)} h ${String(Math.floor(validMs / MIN) % 60).padStart(2, '0')} min`,
    `  program_start: ${fmt(PROGRAM_START)} · último backup simulado: ${fmt(backupAt)}`,
    openSession ? `  Sesión EN CURSO desde ${fmt(openSession.state.start_time)} (live/${STUDENT})` : '  Sin sesión en curso (usa "npm run seed -- --open" para crear una).',
    '',
    '  Casos especiales:',
    ...sessions
      .filter((s) => s.label !== 'normal' && s.label !== 'manual')
      .map((s) => `    - ${formatInTimeZone(s.state.start_time, TZ, 'dd/MM')} ${s.label} (rev ${s.state.rev})`),
    '',
    '  Cuentas (solo emulador):',
    ...Object.values(ACCOUNTS).map((a) => `    ${a.email.padEnd(22)} ${a.password.padEnd(16)} ${a.uid}`),
    '',
    '  App: npm run dev:emu · Emulator UI: http://127.0.0.1:4000',
    '',
  ]
  console.log(lines.join('\n'))
}

main().catch((e) => {
  console.error(`\nError en el seed: ${e instanceof Error ? e.message : String(e)}`)
  process.exitCode = 1
})
