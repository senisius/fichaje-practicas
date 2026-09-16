// Cálculos de tiempo. Todas las funciones son puras y no dependen de la zona horaria del
// proceso ni del navegador: las fechas civiles se calculan siempre en Europe/Madrid.
import { fromZonedTime, getTimezoneOffset } from 'date-fns-tz'
import type { Timestamp } from 'firebase/firestore'
import { DAY_WARN_HOURS, DEFAULT_TARGET_HOURS, LATE_FLAG_HOURS, MAX_SESSION_HOURS, PACE_WEEKS } from './limits'
import type { Session, SessionDoc, SessionStatus } from '../types'

export const TZ = 'Europe/Madrid'
export const HOUR_MS = 3_600_000
export const MINUTE_MS = 60_000
export const DAY_MS = 24 * HOUR_MS
export const WEEK_MS = 7 * DAY_MS
export const MAX_SESSION_MS = MAX_SESSION_HOURS * HOUR_MS

export type DateLike = Date | Timestamp | number

/** Instante en ms de cualquier DateLike. */
export function toMs(d: DateLike): number {
  if (typeof d === 'number') return d
  if (d instanceof Date) return d.getTime()
  return d.toMillis()
}

// ---------- Estado y duración ----------

/** voided ? 'anulada' : end_time == null ? 'en_curso' : 'cerrada' */
export function sessionStatus(s: SessionDoc): SessionStatus {
  if (s.voided) return 'anulada'
  return s.end_time == null ? 'en_curso' : 'cerrada'
}

/** end_time - start_time en ms; 0 si está en curso. Las anuladas devuelven su duración igualmente. */
export function durationMs(s: SessionDoc): number {
  if (s.end_time == null) return 0
  return Math.max(0, s.end_time.toMillis() - s.start_time.toMillis())
}

/** Cerrada y no anulada: lo único que cuenta para el total. */
export function isValidClosed(s: SessionDoc): boolean {
  return s.end_time != null && !s.voided
}

/**
 * Intervalo [inicio, fin) en ms. Las abiertas terminan en nowMs, nunca antes de su inicio ni después
 * de inicio + MAX_SESSION_HOURS (una sesión no puede cerrarse más tarde, así que no cuenta más allá).
 */
export function effectiveInterval(s: SessionDoc, nowMs: number): { start: number; end: number } {
  const start = s.start_time.toMillis()
  const end = s.end_time == null ? Math.min(nowMs, start + MAX_SESSION_MS) : s.end_time.toMillis()
  return { start, end: Math.max(start, end) }
}

/** Objetivo de horas de un perfil: el valor si es un número mayor que 0; si no, DEFAULT_TARGET_HOURS. */
export function resolveTargetHours(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_TARGET_HOURS
}

export interface Progress {
  /** Suma de sesiones cerradas y no anuladas. */
  doneMs: number
  /**
   * Tiempo provisional de la sesión abierta (0 si no hay), con tope MAX_SESSION_HOURS: es lo máximo
   * que puede llegar a contar. Se muestra aparte; no cuenta en doneMs.
   */
  liveMs: number
  /** La sesión abierta supera MAX_SESSION_HOURS: ya no se puede parar con la hora actual. */
  liveOverMax: boolean
  /** 0–100, doneMs / objetivo, con tope 100. */
  pct: number
  remainingMs: number
  targetMs: number
  /** Parte de doneMs que viene de entradas manuales. */
  manualMs: number
  /** Parte de doneMs que viene de fichajes en vivo. */
  liveMethodMs: number
  /** Nº de sesiones válidas con fin ajustado. */
  adjustedCount: number
  /** Nº de sesiones válidas (cerradas, no anuladas). */
  validCount: number
}

/**
 * @param open sesión abierta del student (o null)
 * @param nowMs Date.now() del cliente
 * @param skewMs corrección estimada del reloj del cliente (hora servidor - hora cliente)
 */
export function progress(
  sessions: SessionDoc[],
  targetHours: number,
  open: SessionDoc | null,
  nowMs: number,
  skewMs = 0,
): Progress {
  let doneMs = 0
  let manualMs = 0
  let liveMethodMs = 0
  let adjustedCount = 0
  let validCount = 0
  for (const s of sessions) {
    if (!isValidClosed(s)) continue
    const d = durationMs(s)
    doneMs += d
    if (s.method === 'manual') manualMs += d
    else liveMethodMs += d
    if (s.adjusted) adjustedCount++
    validCount++
  }
  // Objetivo no válido (0, negativo, NaN) → sin objetivo: 100 % y nada restante
  const targetMs = Number.isFinite(targetHours) && targetHours > 0 ? Math.round(targetHours * HOUR_MS) : 0
  const liveElapsed =
    open && open.end_time == null && !open.voided ? Math.max(0, nowMs + skewMs - open.start_time.toMillis()) : 0
  return {
    doneMs,
    liveMs: Math.min(liveElapsed, MAX_SESSION_MS),
    liveOverMax: liveElapsed > MAX_SESSION_MS,
    pct: targetMs > 0 ? Math.min(100, (doneMs / targetMs) * 100) : 100,
    remainingMs: Math.max(0, targetMs - doneMs),
    targetMs,
    manualMs,
    liveMethodMs,
    adjustedCount,
    validCount,
  }
}

/**
 * Restante para mostrar: redondeado al minuto hacia arriba. formatDuration trunca lo hecho al minuto,
 * así que "hecho + restante" cuadra con el objetivo a la vista (y nunca se ve 0 min sin haber llegado).
 */
export function displayRemainingMs(p: Progress): number {
  return Math.ceil(p.remainingMs / MINUTE_MS) * MINUTE_MS
}

/** Porcentaje para mostrar: truncado a una décima, así "100,0 %" solo aparece con el objetivo cumplido. */
export function displayPct(p: Progress): number {
  if (p.remainingMs <= 0) return 100
  // El épsilon evita que 45,3 (guardado como 45,2999…) se muestre como 45,2
  return Math.min(99.9, Math.floor(p.pct * 10 + 1e-9) / 10)
}

// ---------- Formato ----------

const pad2 = (n: number): string => String(n).padStart(2, '0')

function safeMs(ms: number): number {
  return Number.isFinite(ms) && ms > 0 ? ms : 0
}

/** "4 h 08 min", "0 h 05 min", "298 h 00 min". Nunca negativo (valores < 0 → 0). */
export function formatDuration(ms: number): string {
  const v = safeMs(ms)
  const h = Math.floor(v / HOUR_MS)
  const m = Math.floor(v / MINUTE_MS) % 60
  return `${h} h ${pad2(m)} min`
}

/** "01:02:03" (horas pueden superar 99). Para el cronómetro. */
export function formatClock(ms: number): string {
  const totalS = Math.floor(safeMs(ms) / 1000)
  const h = Math.floor(totalS / 3600)
  const m = Math.floor(totalS / 60) % 60
  const s = totalS % 60
  return `${pad2(h)}:${pad2(m)}:${pad2(s)}`
}

/** Horas decimales con coma española: "4,08". */
export function formatHoursDecimal(ms: number, decimals = 2): string {
  return (safeMs(ms) / HOUR_MS).toFixed(decimals).replace('.', ',')
}

/** "63,4 %" (un decimal, coma española). */
export function formatPct(pct: number): string {
  const v = Number.isFinite(pct) ? pct : 0
  return `${v.toFixed(1).replace('.', ',')} %`
}

// ---------- Fechas civiles de Madrid ----------

export interface WallParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

const wallFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
})

/** Fecha y hora de pared en Madrid de un instante. */
export function madridParts(d: DateLike): WallParts {
  const out: WallParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 }
  for (const p of wallFormatter.formatToParts(toMs(d))) {
    if (p.type in out) out[p.type as keyof WallParts] = Number(p.value)
  }
  // Algunos motores devuelven "24" a medianoche
  if (out.hour === 24) out.hour = 0
  return out
}

/** Hora de pared de Madrid expresada como si fuera UTC (ms, sin fracciones de segundo). */
function wallMsOf(t: number): number {
  const p = madridParts(t)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
}

function dateKeyOf(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${pad2(month)}-${pad2(day)}`
}

/** Fecha civil en Madrid, "YYYY-MM-DD". */
export function madridDateKey(d: DateLike): string {
  const p = madridParts(d)
  return dateKeyOf(p.year, p.month, p.day)
}

/** Hora civil en Madrid, "HH:mm". */
export function madridTimeKey(d: DateLike): string {
  const p = madridParts(d)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{2}):(\d{2})$/

/** Valida y descompone "YYYY-MM-DD". Devuelve null si no es una fecha real. */
export function parseDateKey(date: string): { year: number; month: number; day: number } | null {
  const m = DATE_RE.exec(date)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1) return null
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null
  return { year, month, day }
}

/** Valida y descompone "HH:mm" (00:00–23:59). Devuelve null si no es válida. */
export function parseTimeKey(time: string): { hour: number; minute: number } | null {
  const m = TIME_RE.exec(time)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 23 || minute > 59) return null
  return { hour, minute }
}

function invalidDate(date: string): Error {
  return new Error(`La fecha "${date}" no es válida (formato AAAA-MM-DD).`)
}

/** Aritmética de calendario sin zona: la clave se trata como medianoche UTC. */
function dateKeyToUtcMs(date: string): number {
  const p = parseDateKey(date)
  if (!p) throw invalidDate(date)
  return Date.UTC(p.year, p.month - 1, p.day)
}

function utcMsToDateKey(ms: number): string {
  const d = new Date(ms)
  return dateKeyOf(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())
}

/** Suma n días de calendario a una clave "YYYY-MM-DD". */
export function addDaysKey(date: string, n: number): string {
  return utcMsToDateKey(dateKeyToUtcMs(date) + n * DAY_MS)
}

/** 'normal', o si cae en un cambio de hora: 'inexistente' (marzo) o 'repetida' (octubre). */
export type MadridTimeKind = 'normal' | 'inexistente' | 'repetida'

function resolveMadrid(date: string, time: string): { instant: number; kind: MadridTimeKind; options: number[] } {
  const d = parseDateKey(date)
  if (!d) throw invalidDate(date)
  const t = parseTimeKey(time)
  if (!t) throw new Error(`La hora "${time}" no es válida (formato HH:mm, de 00:00 a 23:59).`)
  const wall = Date.UTC(d.year, d.month - 1, d.day, t.hour, t.minute)
  // Madrid nunca tiene dos cambios de hora a menos de 48 h: a ±1 día están el desfase de antes y el de después
  const before = wall - getTimezoneOffset(TZ, wall - DAY_MS)
  const after = wall - getTimezoneOffset(TZ, wall + DAY_MS)
  const guess = fromZonedTime(`${date}T${time}:00`, TZ).getTime()
  const valid = [...new Set([guess, before, after])].filter((c) => wallMsOf(c) === wall).sort((a, b) => a - b)
  if (valid.length === 0) return { instant: before, kind: 'inexistente', options: [before] }
  return { instant: valid[0], kind: valid.length > 1 ? 'repetida' : 'normal', options: valid }
}

/**
 * Convierte fecha "YYYY-MM-DD" + hora "HH:mm" interpretadas en Europe/Madrid a un instante UTC.
 * Lanza Error si el formato no es válido.
 *
 * Cambios de hora (misma política que Temporal `disambiguation: 'compatible'` y RFC 5545):
 * - Hora inexistente (último domingo de marzo, 02:00–02:59): se interpreta con el desfase de antes
 *   del salto, así que avanza lo que dura el salto. 2027-03-28 02:30 → 01:30Z (= 03:30 CEST).
 * - Hora repetida (último domingo de octubre, 02:00–02:59): se toma la primera vez que ocurre
 *   (horario de verano, +02:00). 2026-10-25 02:30 → 00:30Z.
 */
export function madridToUtc(date: string, time: string): Date {
  return new Date(resolveMadrid(date, time).instant)
}

/** Indica si "fecha + hora" de Madrid cae en un cambio de hora. Lanza Error si no es válida. */
export function madridTimeKind(date: string, time: string): MadridTimeKind {
  return resolveMadrid(date, time).kind
}

/**
 * Instantes posibles de "fecha + hora" de Madrid, en orden: uno normalmente (el de madridToUtc) y dos
 * si la hora se repite en octubre (primero el de horario de verano). Lanza Error si no es válida.
 */
export function madridToUtcOptions(date: string, time: string): Date[] {
  return resolveMadrid(date, time).options.map((ms) => new Date(ms))
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una clave de fecha. */
export function isoWeekday(dateKey: string): number {
  const dow = new Date(dateKeyToUtcMs(dateKey)).getUTCDay()
  return dow === 0 ? 7 : dow
}

/** Lunes (fecha "YYYY-MM-DD") de la semana ISO que contiene dateKey. */
export function weekStartKey(dateKey: string): string {
  return addDaysKey(dateKey, 1 - isoWeekday(dateKey))
}

const WEEKDAYS = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

/** "15/09/2026" a partir de "2026-09-15". */
export function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split('-')
  return `${d}/${m}/${y}`
}

/** Etiqueta legible de semana: "Semana del 15/09/2026". */
export function formatWeekLabel(weekStart: string): string {
  return `Semana del ${formatDateKey(weekStart)}`
}

/** "lun 15/09/2026" en hora de Madrid. */
export function formatDate(d: DateLike): string {
  const key = madridDateKey(d)
  return `${WEEKDAYS[isoWeekday(key) - 1]} ${formatDateKey(key)}`
}

/** "15/09/2026" en hora de Madrid (sin día de la semana). */
export function formatDateShort(d: DateLike): string {
  return formatDateKey(madridDateKey(d))
}

/** "09:05" en hora de Madrid. */
export function formatTime(d: DateLike): string {
  return madridTimeKey(d)
}

/** "09:05:37" en hora de Madrid. */
export function formatTimeSeconds(d: DateLike): string {
  const p = madridParts(d)
  return `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`
}

/** "15/09/2026 09:05" en hora de Madrid. */
export function formatDateTime(d: DateLike): string {
  return `${formatDateShort(d)} ${madridTimeKey(d)}`
}

// ---------- Ritmo, marcas y agrupación ----------

/**
 * Fecha estimada de fin: ritmo = horas válidas de las últimas PACE_WEEKS semanas / PACE_WEEKS.
 * Devuelve null si remainingMs == 0 o no hay ritmo reciente.
 * Ventana: sesiones válidas cuyo inicio está en (nowMs - PACE_WEEKS·7 días, nowMs].
 *
 * Con programStartMs (inicio de las prácticas), la ventana no empieza antes de esa fecha y el ritmo
 * se divide por las semanas reales transcurridas (mínimo 1): así, durante el primer mes, la estimación
 * no se retrasa por contar semanas en las que las prácticas aún no habían empezado.
 */
export function estimateFinish(
  sessions: SessionDoc[],
  remainingMs: number,
  nowMs: number,
  programStartMs?: number | null,
): Date | null {
  if (!(remainingMs > 0)) return null
  const paceStart = nowMs - PACE_WEEKS * WEEK_MS
  const windowStart =
    typeof programStartMs === 'number' && Number.isFinite(programStartMs) && programStartMs > paceStart
      ? programStartMs
      : paceStart
  // El borde de hace PACE_WEEKS semanas queda fuera; el inicio de las prácticas, dentro
  const inWindow = (start: number): boolean =>
    (windowStart === paceStart ? start > windowStart : start >= windowStart) && start <= nowMs
  let recentMs = 0
  for (const s of sessions) {
    if (!isValidClosed(s)) continue
    if (inWindow(s.start_time.toMillis())) recentMs += durationMs(s)
  }
  const weeks = windowStart === paceStart ? PACE_WEEKS : Math.max(1, (nowMs - windowStart) / WEEK_MS)
  const perWeekMs = recentMs / weeks
  if (!(perWeekMs > 0)) return null
  return new Date(nowMs + Math.round((remainingMs / perWeekMs) * WEEK_MS))
}

export interface SessionFlags {
  /** ids de otras sesiones válidas (no anuladas) que se solapan en el tiempo con esta. */
  overlapsWith: string[]
  /** El día (Madrid) de esta sesión suma más de DAY_WARN_HOURS entre sesiones válidas. */
  dayOverLimit: boolean
  /** Días entre end_time y created_at si supera LATE_FLAG_HOURS; si no, null. */
  lateDays: number | null
  /** Nº de ediciones de nota: rev - (live cerrada ? 1 : 0) - (voided ? 1 : 0), mínimo 0. */
  editCount: number
}

/** Nº de ediciones de nota (ver SessionFlags.editCount). */
export function editCountOf(s: SessionDoc): number {
  const stops = s.method === 'live' && s.end_time != null ? 1 : 0
  const voids = s.voided ? 1 : 0
  return Math.max(0, s.rev - stops - voids)
}

/** Días completos entre end_time y created_at si la diferencia supera LATE_FLAG_HOURS; si no, null. */
export function lateDaysOf(s: SessionDoc): number | null {
  if (s.end_time == null) return null
  const gap = s.created_at.toMillis() - s.end_time.toMillis()
  if (gap <= LATE_FLAG_HOURS * HOUR_MS) return null
  return Math.floor(gap / DAY_MS)
}

/** true si los intervalos [a0, a1) y [b0, b1) comparten algún instante (tocarse no cuenta). */
export function intervalsOverlap(a0: number, a1: number, b0: number, b1: number): boolean {
  return a0 < b1 && b0 < a1
}

/**
 * Totales por día de Madrid (el de su inicio, aunque crucen la medianoche) de las sesiones no
 * anuladas; las abiertas cuentan hasta nowMs.
 */
export function dayTotals(sessions: SessionDoc[], nowMs: number): Map<string, number> {
  const totals = new Map<string, number>()
  for (const s of sessions) {
    if (s.voided) continue
    const { start, end } = effectiveInterval(s, nowMs)
    const key = madridDateKey(start)
    totals.set(key, (totals.get(key) ?? 0) + (end - start))
  }
  return totals
}

/**
 * Calcula las marcas de todas las sesiones de una vez (las abiertas se tratan como terminando ahora).
 * Las anuladas ya se muestran tachadas: no reciben marcas de solape ni de día (sí lateDays y editCount).
 * Coste O(n log n + k), con k = nº de pares que se solapan.
 */
export function computeFlags(sessions: Session[], nowMs: number): Map<string, SessionFlags> {
  const result = new Map<string, SessionFlags>()
  for (const s of sessions) {
    result.set(s.id, { overlapsWith: [], dayOverLimit: false, lateDays: lateDaysOf(s), editCount: editCountOf(s) })
  }

  const active = sessions
    .filter((s) => !s.voided)
    .map((s) => ({ id: s.id, ...effectiveInterval(s, nowMs) }))
    .sort((a, b) => a.start - b.start || a.end - b.end)

  for (let i = 0; i < active.length; i++) {
    const a = active[i]
    // Ordenadas por inicio: en cuanto una empieza en o después del fin de `a`, las siguientes también
    for (let j = i + 1; j < active.length && active[j].start < a.end; j++) {
      const b = active[j]
      if (a.id === b.id || !intervalsOverlap(a.start, a.end, b.start, b.end)) continue
      result.get(a.id)!.overlapsWith.push(b.id)
      result.get(b.id)!.overlapsWith.push(a.id)
    }
  }

  const totals = dayTotals(sessions, nowMs)
  const limit = DAY_WARN_HOURS * HOUR_MS
  for (const s of sessions) {
    if (s.voided) continue
    result.get(s.id)!.dayOverLimit = (totals.get(madridDateKey(s.start_time)) ?? 0) > limit
  }
  return result
}

/** Orden por start_time descendente (empate: id ascendente). */
export function compareByStartDesc(a: Session, b: Session): number {
  return b.start_time.toMillis() - a.start_time.toMillis() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * Agrupa sesiones por semana ISO (clave = weekStartKey), semanas en orden descendente.
 * Dentro de cada semana, las sesiones van por inicio descendente. validMs = cerradas y no anuladas.
 */
export function groupByWeek(sessions: Session[]): { weekStart: string; sessions: Session[]; validMs: number }[] {
  const weeks = new Map<string, { weekStart: string; sessions: Session[]; validMs: number }>()
  for (const s of sessions) {
    const weekStart = weekStartKey(madridDateKey(s.start_time))
    let w = weeks.get(weekStart)
    if (!w) {
      w = { weekStart, sessions: [], validMs: 0 }
      weeks.set(weekStart, w)
    }
    w.sessions.push(s)
    if (isValidClosed(s)) w.validMs += durationMs(s)
  }
  const out = [...weeks.values()].sort((a, b) => (a.weekStart < b.weekStart ? 1 : a.weekStart > b.weekStart ? -1 : 0))
  for (const w of out) w.sessions.sort(compareByStartDesc)
  return out
}
