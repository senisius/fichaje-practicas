// @ts-check
// Recorrido E2E con Chrome sin interfaz (protocolo DevTools, sin dependencias) contra la app en modo
// emulador. Antes, en terminales aparte:
//   npm run emulators
//   npm run seed -- --open          (el recorrido parte de estos datos: repite el seed antes de cada ejecución)
//   npm run dev:emu                 (http://localhost:5173)
// y después: npm run e2e
//
// Variables de entorno (todas opcionales):
//   E2E_BASE      URL de la app (http://localhost:5173)
//   E2E_CHROME    ruta del ejecutable de Chrome o Chromium (se busca en las rutas habituales)
//   E2E_PORT      puerto de depuración de Chrome (9333)
//   E2E_PROFILE   carpeta temporal del perfil de Chrome (se borra al empezar y al terminar)
//   E2E_SHOTS     carpeta donde guardar capturas (sin ella no se guardan)
//   E2E_MODE      full (por defecto) | smoke (solo la pantalla inicial) | over16 (sesión abierta hace 17 h)
//   E2E_SW        =1 para comprobar el service worker y la página sin conexión (solo con npm run preview)
//   E2E_EXPECT    texto de la pantalla inicial ("Iniciar sesión")
//   E2E_FIRESTORE host:puerto del emulador de Firestore para el modo over16 (127.0.0.1:8181)
// Sale con código 0 si todo va bien y 1 si algo falla.
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const env = (name, fallback) => process.env[name] || fallback
const BASE = env('E2E_BASE', 'http://localhost:5173').replace(/\/$/, '')
const PORT = Number(env('E2E_PORT', '9333'))
const PROFILE = env('E2E_PROFILE', path.join(tmpdir(), 'fichaje-e2e-profile'))
const SHOTS = process.env.E2E_SHOTS || null
const MODE = env('E2E_MODE', 'full')
const EXPECT = env('E2E_EXPECT', 'Iniciar sesión')
const FIRESTORE = env('E2E_FIRESTORE', '127.0.0.1:8181')
const PROJECT = 'demo-fichaje'
const STUDENT_UID = 'uid-estudiante'

if (!['full', 'smoke', 'over16'].includes(MODE)) {
  console.error(`E2E_MODE desconocido: ${MODE} (usa full, smoke u over16)`)
  process.exit(2)
}

function findChrome() {
  if (process.env.E2E_CHROME) return process.env.E2E_CHROME
  const candidates = [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean)
  return candidates.find((c) => existsSync(/** @type {string} */ (c))) ?? 'google-chrome'
}

rmSync(PROFILE, { recursive: true, force: true })
if (SHOTS) mkdirSync(SHOTS, { recursive: true })

const chromePath = findChrome()
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--disable-extensions',
    '--lang=es-ES',
    'about:blank',
  ],
  { stdio: 'ignore' },
)
chrome.on('error', (e) => {
  console.error(`No se puede arrancar Chrome (${chromePath}): ${e.message}. Indica la ruta con E2E_CHROME.`)
  process.exit(1)
})

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms))
let failures = 0
const log = console.log
/** @param {unknown} ok @param {string} msg */
function check(ok, msg) {
  if (ok) log('  OK   ', msg)
  else {
    failures++
    log('  FALLO', msg)
  }
}

async function targetWs() {
  for (let i = 0; i < 100; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((/** @type {{ type: string }} */ t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Chrome aún arrancando
    }
    await sleep(200)
  }
  throw new Error(`Chrome no responde en el puerto ${PORT}`)
}

const ws = new WebSocket(await targetWs())
await new Promise((r) => ws.addEventListener('open', r, { once: true }))
let nextId = 0
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void }>} */
const pending = new Map()
/** @type {string[]} */
const consoleMessages = []
let exceptions = 0
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data))
  if (msg.id && pending.has(msg.id)) {
    const p = /** @type {NonNullable<ReturnType<typeof pending.get>>} */ (pending.get(msg.id))
    pending.delete(msg.id)
    if (msg.error) p.reject(new Error(msg.error.message))
    else p.resolve(msg.result)
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    const args = msg.params.args.map((/** @type {any} */ a) => a.value ?? a.description ?? '').join(' ')
    consoleMessages.push(`${msg.params.type}: ${args}`.slice(0, 300))
  } else if (msg.method === 'Runtime.exceptionThrown') {
    exceptions++
    const d = msg.params.exceptionDetails
    consoleMessages.push(`excepción: ${d.exception?.description ?? d.text}`.slice(0, 300))
  }
})

/** @param {string} method @param {object} [params] @returns {Promise<any>} */
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId
    pending.set(id, { resolve, reject })
    ws.send(JSON.stringify({ id, method, params }))
  })

/** Ejecuta una función en la página. @param {Function} fn @param {...unknown} args */
async function evaluate(fn, ...args) {
  const expression = `(${fn.toString()})(...${JSON.stringify(args)})`
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
  return r.result.value
}

const bodyText = () => evaluate(() => document.body.innerText)

let shotN = 0
/** @param {string} name */
async function shot(name) {
  if (!SHOTS) return
  const r = await send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(path.join(SHOTS, `${String(++shotN).padStart(2, '0')}-${name}.png`), Buffer.from(r.data, 'base64'))
}

/** @param {string | RegExp} text */
async function waitText(text, timeout = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const body = await bodyText()
    if (typeof text === 'string' ? body.includes(text) : text.test(body)) return
    await sleep(150)
  }
  await shot(`espera-${String(text).replace(/[^a-z0-9]+/gi, '_').slice(0, 30)}`)
  throw new Error(`No aparece "${text}". Texto de la página:\n${(await bodyText()).slice(0, 1500)}`)
}

/** @param {string} text */
async function waitNoText(text, timeout = 15_000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    if (!(await bodyText()).includes(text)) return
    await sleep(150)
  }
  throw new Error(`Sigue apareciendo "${text}"`)
}

/**
 * Pulsa el primer botón (del último diálogo si within = 'dialog') cuyo texto contenga label.
 * @param {string} label @param {{ within?: 'dialog' | null, exact?: boolean }} [opts]
 */
async function click(label, { within = null, exact = false } = {}) {
  const result = await evaluate(
    (label, within, exact) => {
      const root = within ? [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].at(-1) : document
      if (!root) return 'sin diálogo'
      const norm = (/** @type {string} */ s) => s.replace(/\s+/g, ' ').trim()
      const btn = /** @type {HTMLButtonElement[]} */ ([...root.querySelectorAll('button')]).find((b) =>
        exact ? norm(b.textContent ?? '') === label : norm(b.textContent ?? '').includes(label),
      )
      if (!btn) return 'no existe'
      if (btn.disabled) return 'desactivado'
      btn.click()
      return 'ok'
    },
    label,
    within,
    exact,
  )
  if (result !== 'ok') throw new Error(`Botón "${label}": ${result}`)
}

/** @param {string} label */
const hasButton = (label) =>
  evaluate(
    (label) => [...document.querySelectorAll('button')].some((b) => (b.textContent ?? '').replace(/\s+/g, ' ').includes(label)),
    label,
  )

/** Escribe en el campo cuya etiqueta es labelText (en el último diálogo abierto, si hay). */
async function fill(/** @type {string} */ labelText, /** @type {string} */ value) {
  const result = await evaluate(
    (labelText, value) => {
      const root = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].at(-1) ?? document
      const label = /** @type {HTMLLabelElement[]} */ ([...root.querySelectorAll('label')]).find(
        (l) => (l.firstChild?.textContent ?? '').trim() === labelText,
      )
      if (!label) return 'sin etiqueta'
      const el = /** @type {HTMLInputElement | HTMLTextAreaElement | null} */ (document.getElementById(label.htmlFor))
      if (!el) return 'sin control'
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return 'ok'
    },
    labelText,
    value,
  )
  if (result !== 'ok') throw new Error(`Campo "${labelText}": ${result}`)
}

/** @param {string} key */
async function press(key) {
  /** @type {Record<string, number>} */
  const codes = { Escape: 27, Tab: 9, Enter: 13 }
  // Enter necesita el carácter para activar un botón
  const text = key === 'Enter' ? String.fromCharCode(13) : undefined
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, windowsVirtualKeyCode: codes[key] ?? 0, text })
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: codes[key] ?? 0 })
}

/** Nombre del elemento con el foco ("body" si no hay ninguno). */
const activeElement = () =>
  evaluate(() => {
    const a = document.activeElement
    return !a || a === document.body ? 'body' : `${a.tagName.toLowerCase()}${a.textContent ? `:${a.textContent.trim().slice(0, 30)}` : ''}`
  })

/** @param {number} ms @param {Intl.DateTimeFormatOptions} opts */
const madrid = (ms, opts) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', hourCycle: 'h23', ...opts }).format(ms)
const madridDate = (/** @type {number} */ ms) => madrid(ms, { year: 'numeric', month: '2-digit', day: '2-digit' })
const madridTime = (/** @type {number} */ ms) => madrid(ms, { hour: '2-digit', minute: '2-digit' })

const goto = (/** @type {string} */ url) => send('Page.navigate', { url })

/** @param {string} email @param {string} password @param {string | RegExp} expectText */
async function login(email, password, expectText) {
  await goto(`${BASE}/`)
  await waitText('Iniciar sesión')
  await fill('Correo electrónico', email)
  await fill('Contraseña', password)
  await click('Entrar', { exact: true })
  await waitText(expectText, 20_000)
}

async function logout() {
  await click('Menú de la cuenta')
  await click('Cerrar sesión')
  await waitText('Iniciar sesión')
}

// API REST del emulador con permisos de administración (se salta las reglas)
const REST_ROOT = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents`
const REST_HEADERS = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' }

/** Id de la sesión abierta del estudiante (live/uid-estudiante). */
async function openSessionId() {
  const live = await (await fetch(`${REST_ROOT}/live/${STUDENT_UID}`, { headers: REST_HEADERS })).json()
  const id = live?.fields?.session_id?.stringValue
  if (!id) throw new Error('No hay ninguna sesión abierta (¿falta `npm run seed -- --open`?)')
  return id
}

/** Simula que otro dispositivo para la sesión abierta con otra nota. */
async function stopFromOtherDevice(/** @type {string} */ note) {
  const id = await openSessionId()
  const now = new Date().toISOString()
  const fields = { end_time: { timestampValue: now }, updated_at: { timestampValue: now }, note: { stringValue: note }, rev: { integerValue: '1' } }
  const mask = Object.keys(fields).map((f) => `updateMask.fieldPaths=${f}`).join('&')
  const patch = await fetch(`${REST_ROOT}/sessions/${id}?${mask}`, { method: 'PATCH', headers: REST_HEADERS, body: JSON.stringify({ fields }) })
  if (!patch.ok) throw new Error(`El emulador respondió ${patch.status} al parar la sesión`)
  const del = await fetch(`${REST_ROOT}/live/${STUDENT_UID}`, { method: 'DELETE', headers: REST_HEADERS })
  if (!del.ok) throw new Error(`El emulador respondió ${del.status} al borrar el cerrojo`)
}

/** Mueve la sesión abierta sembrada (live/uid-estudiante) a hace 17 h, con la API REST del emulador. */
async function ageOpenSession() {
  const root = REST_ROOT
  const headers = REST_HEADERS
  const id = await openSessionId()
  const at = new Date(Date.now() - 17 * 3_600_000).toISOString()
  const fields = ['start_time', 'created_at', 'updated_at']
  const mask = fields.map((f) => `updateMask.fieldPaths=${f}`).join('&')
  const res = await fetch(`${root}/sessions/${id}?${mask}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ fields: Object.fromEntries(fields.map((f) => [f, { timestampValue: at }])) }),
  })
  if (!res.ok) throw new Error(`El emulador respondió ${res.status} al envejecer la sesión`)
}

async function studentFlow() {
  log('Estudiante')
  await login('estudiante@demo.test', 'demo-estudiante', 'PARAR')
  const t = await bodyText()
  for (const s of ['Estudiante Demo', 'En curso desde las', 'Tu progreso', 'de 298 h', 'Última copia de seguridad',
    'hace 3 días', 'Historial', 'Semana del', 'fin ajustado', 'anulada', 'nota editada (1)',
    'registrada 5 días después', 'solapa con', 'día > 10 h', 'en curso', 'Terminé antes / olvidé parar',
    'Añadir horas a mano', 'aprox.', 'Fin estimado']) {
    check(t.toLowerCase().includes(s.toLowerCase()), `muestra "${s}"`)
  }
  check(/\+ \d+ h \d{2} min en curso/.test(t), 'progreso con "+ … en curso"')
  check(/\d{2}:\d{2}:\d{2}/.test(t), 'cronómetro')
  await shot('estudiante')

  // Borrador de la nota: sobrevive a una recarga y se guarda con «Guardar nota»
  await fill('Nota de la sesión', 'Borrador E2E antes de recargar')
  await waitText('Cambios sin guardar en el servidor.')
  await send('Page.reload')
  await waitText('PARAR', 20_000)
  const restored = await evaluate(() => /** @type {HTMLTextAreaElement | null} */ (document.querySelector('.clock-note textarea'))?.value)
  check(restored === 'Borrador E2E antes de recargar', `el borrador de la nota se restaura al recargar (${restored})`)
  await click('Guardar nota', { exact: true })
  await waitText('Nota guardada.')
  await waitNoText('Cambios sin guardar en el servidor.')
  const stored = await evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fichaje-practicas:note:')).length)
  check(stored === 0, 'tras guardar no queda borrador local')

  // Cierre ajustado de la sesión sembrada (abierta hace 2 h): fin hace 30 min
  await click('Terminé antes / olvidé parar')
  await waitText('¿A qué hora terminaste?')
  const end = Date.now() - 30 * 60_000
  await fill('Fecha de fin', madridDate(end))
  await fill('Hora de fin', madridTime(end))
  await fill('Motivo', 'Salí antes y olvidé parar (E2E)')
  await waitText('duración resultante')
  await shot('cierre-ajustado')
  await click('Cerrar sesión con esta hora')
  await waitText('Sesión cerrada con la hora indicada.')
  await waitText('EMPEZAR')
  check((await bodyText()).includes('Sin sesión en curso'), 'sin sesión tras el cierre ajustado')

  // EMPEZAR y PARAR con nota
  await click('EMPEZAR', { exact: true })
  await waitText('Sesión iniciada.')
  await waitText('PARAR')
  // Con fin anterior al inicio, el diálogo muestra el error y no deja cerrar
  await click('Terminé antes / olvidé parar')
  await waitText('¿A qué hora terminaste?')
  await fill('Fecha de fin', madridDate(Date.now() - 60 * 60_000))
  await fill('Hora de fin', madridTime(Date.now() - 60 * 60_000))
  await fill('Motivo', 'Motivo de prueba suficientemente largo')
  await waitText('tiene que ser posterior al inicio')
  await click('Cancelar', { within: 'dialog' })
  await waitNoText('¿A qué hora terminaste?')
  await fill('Nota de la sesión', 'Prueba E2E: sesión en vivo')
  await sleep(1200)
  await click('PARAR', { exact: true })
  await waitText('Sesión terminada.')
  await waitText('EMPEZAR')
  check((await bodyText()).includes('Prueba E2E: sesión en vivo'), 'la nota aparece en el historial')

  // Entrada manual (hace 2 días a las 16:00, 1 h 30 min)
  await click('Añadir horas a mano')
  await waitText('Para días en los que no pudiste fichar en vivo.')
  await fill('Fecha', madridDate(Date.now() - 2 * 86_400_000))
  await fill('Hora', '16:00')
  await fill('Horas', '1.')
  await waitText('Las horas deben ser un número entero')
  await fill('Horas', '1')
  await fill('Minutos', '30')
  await fill('Nota', 'abc')
  await waitText('al menos 5 caracteres')
  check(!(await hasButton('Guardar igualmente')), 'sin confirmación con errores')
  await fill('Nota', 'Formación E2E desde casa')
  await waitText('Se registrará el')
  await shot('manual')
  await click('Guardar', { within: 'dialog', exact: true })
  await sleep(800)
  if (await hasButton('Guardar igualmente')) {
    log('  (hay avisos: se confirma)')
    await click('Guardar igualmente')
  }
  await waitText('Horas añadidas al registro.')
  await waitText('Formación E2E desde casa')

  // Con el aviso aún visible, el pie de un diálogo nuevo sigue siendo pulsable (móvil)
  await click('Añadir horas a mano')
  await waitText('Para días en los que no pudiste fichar en vivo.')
  check((await bodyText()).includes('Horas añadidas al registro.'), 'el aviso sigue visible al reabrir el diálogo')
  const cancelHit = await evaluate(() => {
    const dialog = [...document.querySelectorAll('[role=dialog]')].at(-1)
    const btn = [...(dialog?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === 'Cancelar')
    if (!btn) return 'sin botón'
    const r = btn.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return hit?.closest('button') === btn ? 'ok' : `tapado por ${hit?.className}`
  })
  check(cancelHit === 'ok', `el aviso no tapa "Cancelar" (${cancelHit})`)
  await shot('aviso-y-pie')
  // Un clic en el fondo no cierra ni saca el foco del diálogo; Escape sigue funcionando
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 4, y: 4, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 4, y: 4, button: 'left', clickCount: 1 })
  await sleep(200)
  check((await bodyText()).includes('Para días en los que no pudiste fichar en vivo.'), 'el clic en el fondo no cierra el diálogo')
  check((await activeElement()) !== 'body', 'el foco sigue en el diálogo tras pulsar el fondo')
  await press('Escape')
  await waitNoText('Para días en los que no pudiste fichar en vivo.')

  // Detalle: editar nota (Escape cancela solo la edición) y anular
  const opened = await evaluate(() => {
    const row = /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('button.session-row')]).find((b) =>
      (b.textContent ?? '').includes('Formación E2E desde casa'),
    )
    row?.click()
    return Boolean(row)
  })
  check(opened, 'abre el detalle de la entrada manual')
  await waitText('Historial de cambios')
  await waitText('Entrada manual registrada')
  await click('Editar nota')
  await fill('Nueva nota', 'Texto que se descarta')
  await press('Escape')
  await sleep(300)
  const afterEsc = await bodyText()
  check(afterEsc.includes('Historial de cambios') && afterEsc.includes('Editar nota'), 'Escape cancela la edición sin cerrar el panel')
  check(!afterEsc.includes('Texto que se descarta'), 'la edición cancelada no se guarda')
  await click('Editar nota')
  await fill('Nueva nota', 'Formación E2E desde casa (editada)')
  await click('Guardar nota', { within: 'dialog' })
  await waitText('Nota guardada.')
  await waitText('1. Nota editada')
  const snapshot = await evaluate(() => document.querySelector('.snapshot-grid')?.textContent ?? '')
  check(snapshot.includes('Nota') && !snapshot.includes('Propietario') && !snapshot.includes('Versión'), 'el estado anterior no muestra uid ni versión')
  await click('Anular sesión…')
  await waitText('Esta acción no se puede deshacer')
  await fill('Motivo de la anulación', 'Duplicada en la prueba E2E')
  check(
    await evaluate(() => /** @type {HTMLButtonElement | undefined} */ ([...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes('Anular definitivamente')))?.disabled),
    'anular exige la casilla',
  )
  await evaluate(() => /** @type {HTMLInputElement} */ (document.querySelector('[role=alertdialog] input[type=checkbox]')).click())
  await click('Anular definitivamente')
  await waitText('Sesión anulada.')
  await waitText('Sesión anulada: no cuenta en el total')
  await waitText('2. Anulación')
  check(!(await hasButton('Editar nota')), 'sin editar nota en una anulada')
  await sleep(300)
  check((await activeElement()) !== 'body', 'el foco sigue dentro del detalle tras anular')
  await shot('detalle-anulada')
  await press('Escape')
  await waitNoText('Historial de cambios')

  // Una sesión abierta para la supervisora (EMPEZAR con el teclado: el foco vuelve al botón)
  await evaluate(() => /** @type {HTMLButtonElement} */ ([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'EMPEZAR'))?.focus())
  await press('Enter')
  await waitText('PARAR')
  await sleep(300)
  check((await activeElement()).startsWith('button:PARAR'), `tras EMPEZAR con el teclado el foco está en PARAR (${await activeElement()})`)

  // Otro dispositivo para la sesión mientras aquí hay una nota sin guardar y el cierre ajustado abierto
  await fill('Nota de la sesión', 'Nota escrita solo en el portátil')
  await waitText('Cambios sin guardar en el servidor.')
  await click('Terminé antes / olvidé parar')
  await waitText('¿A qué hora terminaste?')
  await stopFromOtherDevice('Nota del móvil')
  await waitText('La sesión se ha parado desde otro dispositivo.')
  await waitNoText('¿A qué hora terminaste?')
  await waitText('Una nota no llegó a guardarse')
  check((await bodyText()).includes('Nota escrita solo en el portátil'), 'se ofrece la nota que no llegó a guardarse')
  await shot('nota-no-guardada')
  await click('Descartar')
  await waitNoText('Una nota no llegó a guardarse')
  await sleep(1000)

  // Sesión abierta para la supervisora
  await click('EMPEZAR', { exact: true })
  await waitText('PARAR')
  await sleep(300)
  check((await bodyText()).includes('Sin sesión en curso') === false, 'la sesión nueva está en curso')
  check(!(await bodyText()).includes('¿A qué hora terminaste?'), 'el cierre ajustado no reaparece solo con la sesión nueva')
  await logout()
}

async function supervisorFlow() {
  log('Supervisora')
  await login('profesora@demo.test', 'demo-profesora', /ahora mismo/i)
  await waitText('En curso desde')
  const s = await bodyText()
  for (const x of ['Profesora Demo', 'Supervisora', 'Estudiante Demo lleva', 'Progreso', 'Historial', 'Con marcas', 'Anuladas']) {
    check(s.toLowerCase().includes(x.toLowerCase()), `muestra "${x}"`)
  }
  check(!s.includes('EMPEZAR') && !s.includes('Añadir horas a mano'), 'sin controles de fichaje')
  await shot('supervisora')
  await click('Ver la sesión y comentar')
  await waitText('Comentarios')
  check(!(await hasButton('Editar nota')) && !(await hasButton('Anular sesión')), 'sin controles de edición en el detalle')
  // Con texto sin enviar, Escape pide confirmación
  await fill('Añadir un comentario', 'Comentario E2E de la profesora')
  await press('Escape')
  await waitText('¿Descartar el texto sin guardar?')
  await click('Seguir escribiendo')
  await waitNoText('¿Descartar el texto sin guardar?')
  check((await bodyText()).includes('Añadir un comentario'), 'el panel sigue abierto tras "Seguir escribiendo"')
  await click('Enviar comentario')
  await waitText('Comentario enviado.')
  await waitText('Comentario E2E de la profesora')
  await sleep(300)
  check((await activeElement()).startsWith('textarea'), 'tras enviar, el foco vuelve a la caja del comentario')
  await press('Escape')
  await waitNoText('Añadir un comentario')
  await evaluate(() => /** @type {HTMLButtonElement[]} */ ([...document.querySelectorAll('.filter-chip')]).find((b) => (b.textContent ?? '').includes('Anuladas'))?.click())
  await sleep(300)
  const voidedRows = await evaluate(() => document.querySelectorAll('button.session-row').length)
  check(voidedRows === 2, `el filtro Anuladas muestra 2 sesiones (hay ${voidedRows})`)
  check((await bodyText()).includes('Total válido de la semana'), 'con un filtro, el total semanal lleva su etiqueta visible')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
  await sleep(300)
  await shot('supervisora-escritorio')
  if (SHOTS) {
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] })
    await sleep(300)
    await shot('supervisora-escritorio-oscuro')
    await send('Emulation.setEmulatedMedia', { features: [] })
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })
  await logout()
}

async function otherAccountsFlow() {
  log('Sin perfil, backup y credenciales incorrectas')
  await login('sinperfil@demo.test', 'demo-sinperfil', 'Tu cuenta no tiene acceso')
  await click('Cerrar sesión')
  await waitText('Iniciar sesión')
  await login('backup@demo.test', 'demo-backup', 'Cuenta técnica')
  await click('Cerrar sesión')
  await waitText('Iniciar sesión')
  await fill('Correo electrónico', 'estudiante@demo.test')
  await fill('Contraseña', 'mala')
  await click('Entrar', { exact: true })
  await waitText('Correo o contraseña incorrectos.')

  log('Estudiante (final)')
  await login('estudiante@demo.test', 'demo-estudiante', 'PARAR')
  await click('PARAR', { exact: true })
  await waitText('EMPEZAR')
  await logout()
}

async function over16Flow() {
  log('Sesión abierta hace 17 h')
  await ageOpenSession()
  await login('profesora@demo.test', 'demo-profesora', /ahora mismo/i)
  await waitText('Han pasado más de 16 h')
  const sup = await bodyText()
  check(sup.includes('+ más de 16 h en curso'), 'el progreso no cuenta las 17 h como "en curso"')
  check(!sup.includes('puede que haya olvidado parar'), 'pasadas 16 h, el aviso es el de indicar la hora real')
  await shot('supervisora-mas-de-16h')
  await logout()
  await login('estudiante@demo.test', 'demo-estudiante', '¿A qué hora terminaste?')
  const t16 = await bodyText()
  check(t16.includes('Han pasado más de 16 h'), 'aviso de más de 16 h')
  check(!(await evaluate(() => [...document.querySelectorAll('button')].some((b) => b.textContent?.trim() === 'PARAR'))), 'sin botón PARAR')
  await shot('estudiante-mas-de-16h')
  const startMs = Date.now() - 17 * 3_600_000
  await click('¿A qué hora terminaste?')
  await waitText('Sesión iniciada el')
  const end = startMs + 8 * 3_600_000
  await fill('Fecha de fin', madridDate(end))
  await fill('Hora de fin', madridTime(end))
  await fill('Motivo', 'Olvidé parar ayer al salir de la oficina')
  await waitText('duración resultante')
  await click('Cerrar sesión con esta hora')
  await waitText('Sesión cerrada con la hora indicada.')
  await waitText('EMPEZAR')

  log('Sin conexión dentro de la app')
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await waitText('Sin conexión. Puedes consultar los datos')
  const startBtn = () => evaluate(() => /** @type {HTMLButtonElement | undefined} */ ([...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'EMPEZAR'))?.disabled)
  check(await startBtn(), 'EMPEZAR desactivado sin conexión')
  await shot('sin-conexion')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await waitNoText('Sin conexión. Puedes consultar los datos')
  check(!(await startBtn()), 'EMPEZAR activo al volver la conexión')
  await logout()
}

async function serviceWorkerFlow() {
  log('Service worker y página sin conexión')
  let script = null
  for (let i = 0; i < 50 && !script; i++) {
    script = await evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL ?? null)
    if (!script) await sleep(200)
  }
  check(script?.endsWith('/sw.js'), `service worker activo (${script})`)
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await goto(`${BASE}/cualquier/ruta`)
  await waitText('Para fichar hace falta conexión a internet')
  await shot('pagina-sin-conexion')
  await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 })
  await goto(`${BASE}/`)
  await waitText(EXPECT, 20_000)
}

try {
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true })

  log(`Pantalla inicial (${BASE}, modo ${MODE})`)
  await goto(`${BASE}/`)
  await waitText(EXPECT, 20_000)
  const first = await bodyText()
  check(first.includes('Herramienta personal, no oficial de la UAB.'), 'aviso de herramienta no oficial')
  check(!/Accés UAB|NIU|SSO/.test(first), 'no imita el acceso de la UAB')
  const manifest = await evaluate(() => /** @type {HTMLLinkElement | null} */ (document.querySelector('link[rel=manifest]'))?.href ?? null)
  check(manifest?.endsWith('/manifest.webmanifest'), 'enlace al manifest')
  await shot('inicial')

  if (process.env.E2E_SW) await serviceWorkerFlow()
  if (MODE === 'over16') await over16Flow()
  if (MODE === 'full') {
    await studentFlow()
    await supervisorFlow()
    await otherAccountsFlow()
  }
} catch (e) {
  failures++
  log('ERROR', e instanceof Error ? e.message : e)
  await shot('error').catch(() => {})
} finally {
  const relevant = consoleMessages.filter((m) => !/Download the React DevTools/.test(m))
  log(`Consola: ${relevant.length} errores o avisos`)
  for (const m of relevant) log('   ', m)
  if (exceptions > 0) {
    failures++
    log(`  FALLO ${exceptions} excepciones sin capturar en la página`)
  }
  ws.close()
  chrome.kill()
  await sleep(800)
  try {
    rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 })
  } catch {
    log(`  (no se ha podido borrar el perfil temporal ${PROFILE})`)
  }
  log(failures === 0 ? 'E2E OK' : `E2E con ${failures} fallos`)
  process.exit(failures === 0 ? 0 : 1)
}
