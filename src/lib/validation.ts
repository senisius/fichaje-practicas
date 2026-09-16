// Espejo en cliente de firestore.rules: el cliente valida antes de enviar para dar mensajes
// claros; la seguridad real está en las reglas. Los textos se recortan (cleanText) antes de validar,
// igual que hace api.ts antes de guardar. Longitudes: en el emulador, string.size() cuenta unidades
// UTF-16 (un emoji = 2) y trim() solo quita caracteres <= U+0020. Por eso el mínimo se mide en
// caracteres (textLength) y el máximo en unidades UTF-16 (storedLength): lo que acepta el cliente
// lo aceptan las reglas cuente size() de una forma u otra.
import {
  DAY_WARN_HOURS,
  DEFAULT_MANUAL_TIME,
  MAX_BACKDATE_DAYS,
  MAX_COMMENT,
  MAX_NOTE,
  MAX_REASON,
  MAX_SESSION_HOURS,
  MIN_MANUAL_NOTE,
  MIN_REASON,
  WARN_OPEN_HOURS,
} from './limits'
import {
  DAY_MS,
  HOUR_MS,
  MAX_SESSION_MS,
  MINUTE_MS,
  dayTotals,
  effectiveInterval,
  formatDate,
  formatDateKey,
  formatDateTime,
  formatDuration,
  formatTime,
  intervalsOverlap,
  madridDateKey,
  madridTimeKind,
  madridTimeKey,
  madridToUtc,
  parseDateKey,
  parseTimeKey,
} from './time'
import type { Session } from '../types'

export interface ManualInput {
  /** "YYYY-MM-DD" (Madrid) */
  date: string
  /** "HH:mm" (Madrid). Vacío o undefined → DEFAULT_MANUAL_TIME. */
  time?: string
  /** Duración en minutos, entero >= 1 */
  minutes: number
  note: string
}

/** Años anteriores no son fechas de prácticas (y Date.UTC trata 0–99 como 1900–1999). */
const MIN_YEAR = 2000

export interface ValidationResult {
  /** Bloquean el envío (lo rechazarían las reglas). */
  errors: string[]
  /** No bloquean; se muestran antes de confirmar (solapes, día > 10 h). */
  warnings: string[]
}

// Espacios (los de trim()) y caracteres de control, que el trim() de las reglas también quita
const isEdgeChar = (ch: string): boolean => ch.charCodeAt(0) <= 0x20 || /\s/.test(ch)

/** Recorte que se aplica a todos los textos antes de validarlos y guardarlos. */
export function cleanText(s: string | null | undefined): string {
  const t = s ?? ''
  let from = 0
  let to = t.length
  while (from < to && isEdgeChar(t[from])) from++
  while (to > from && isEdgeChar(t[to - 1])) to--
  return t.slice(from, to)
}

/** Longitud en caracteres (puntos de código: un emoji = 1). */
export function textLength(s: string): number {
  return Array.from(s).length
}

/** Longitud como la mide string.size() en el emulador y maxlength en el navegador (un emoji = 2). */
export function storedLength(s: string): number {
  return s.length
}

/** Hora efectiva de una entrada manual (la indicada o DEFAULT_MANUAL_TIME). */
export function manualTimeOf(input: Pick<ManualInput, 'time'>): string {
  return cleanText(input.time) || DEFAULT_MANUAL_TIME
}

/** Inicio y fin (ms) de una entrada manual, o null si la fecha, la hora o los minutos no son válidos. */
export function manualInterval(input: ManualInput): { start: number; end: number } | null {
  const date = cleanText(input.date)
  const time = manualTimeOf(input)
  if (!parseDateKey(date) || !parseTimeKey(time) || !Number.isInteger(input.minutes) || input.minutes < 1) return null
  const start = madridToUtc(date, time).getTime()
  return { start, end: start + input.minutes * MINUTE_MS }
}

const chars = (n: number): string => (n === 1 ? '1 carácter' : `${n} caracteres`)

/** `label` empieza por "La " o "El " (concordancia de "obligatoria/o"). */
function lengthErrors(text: string, label: string, min: number, max: number): string[] {
  const n = textLength(text)
  if (n < min) {
    const required = label.startsWith('La ') ? 'obligatoria' : 'obligatorio'
    return n === 0
      ? [`${label} es ${required}: escribe al menos ${chars(min)}.`]
      : [`${label} debe tener al menos ${chars(min)} (ahora tiene ${n}).`]
  }
  const size = storedLength(text)
  if (size > max) {
    return size === n
      ? [`${label} puede tener como máximo ${chars(max)} (ahora tiene ${n}).`]
      : [`${label} puede tener como máximo ${chars(max)} (ahora ocupa ${size}: los emojis y algunos símbolos cuentan como 2).`]
  }
  return []
}

/**
 * Valida una entrada manual: fin > inicio, duración <= MAX_SESSION_HOURS, fin <= ahora,
 * inicio >= programStart, inicio >= ahora - MAX_BACKDATE_DAYS, nota >= MIN_MANUAL_NOTE.
 * Avisos: solapa con sesiones válidas existentes, el día supera DAY_WARN_HOURS.
 */
export function validateManual(
  input: ManualInput,
  ctx: { nowMs: number; programStart: Date | null; sessions: Session[] },
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const date = cleanText(input.date)
  const time = manualTimeOf(input)

  let start: number | null = null
  const parsed = date ? parseDateKey(date) : null
  if (!date) errors.push('Indica la fecha.')
  else if (!parsed) errors.push(`La fecha "${date}" no es válida (formato AAAA-MM-DD).`)
  // Un año a medio teclear ("0026") daría horas históricas y avisos de cambio de hora falsos
  else if (parsed.year < MIN_YEAR) errors.push(`Revisa el año de la fecha (${formatDateKey(date)}).`)
  else if (!parseTimeKey(time)) errors.push(`La hora "${time}" no es válida (formato HH:mm, de 00:00 a 23:59).`)
  else start = madridToUtc(date, time).getTime()

  const { minutes } = input
  const minutesOk = Number.isInteger(minutes) && minutes >= 1
  if (!minutesOk) {
    errors.push(`La duración tiene que ser un número entero de minutos mayor que 0 (has indicado ${String(minutes)}).`)
  } else if (minutes * MINUTE_MS > MAX_SESSION_MS) {
    errors.push(
      `Una entrada puede durar como máximo ${MAX_SESSION_HOURS} h (has indicado ${formatDuration(minutes * MINUTE_MS)}).`,
    )
  }

  if (start != null) {
    if (minutesOk) {
      const end = start + minutes * MINUTE_MS
      if (end > ctx.nowMs) {
        errors.push(
          `No puedes registrar horas en el futuro: la entrada terminaría el ${formatDateTime(end)} y ahora es ${formatDateTime(ctx.nowMs)}.`,
        )
      }
    }
    if (ctx.programStart && start < ctx.programStart.getTime()) {
      errors.push(
        `La entrada empezaría el ${formatDateTime(start)}, antes del inicio de las prácticas (${formatDateTime(ctx.programStart)}).`,
      )
    }
    // Igual que la regla: inicio + 744 h >= ahora
    const oldest = ctx.nowMs - MAX_BACKDATE_DAYS * DAY_MS
    if (start < oldest) {
      errors.push(
        `Solo puedes registrar horas de los últimos ${MAX_BACKDATE_DAYS} días: la entrada empezaría el ${formatDateTime(start)} y lo más antiguo permitido es el ${formatDateTime(oldest)}.`,
      )
    }
  }

  const note = cleanText(input.note)
  errors.push(...lengthErrors(note, 'La nota (qué has hecho)', MIN_MANUAL_NOTE, MAX_NOTE))

  if (start != null) {
    const kind = madridTimeKind(date, time)
    if (kind === 'inexistente') {
      warnings.push(
        `Las ${time} del ${formatDateKey(date)} no existen por el cambio de hora: se guardará como las ${madridTimeKey(start)}.`,
      )
    } else if (kind === 'repetida') {
      warnings.push(
        `Las ${time} del ${formatDateKey(date)} ocurren dos veces por el cambio de hora: se tomará la primera (horario de verano).`,
      )
    }
  }

  if (start != null && minutesOk) {
    const end = start + minutes * MINUTE_MS
    const others = ctx.sessions
      .filter((s) => !s.voided)
      .map((s) => ({ s, ...effectiveInterval(s, ctx.nowMs) }))
      .filter((o) => intervalsOverlap(start, end, o.start, o.end))
      .sort((a, b) => a.start - b.start)
    for (const o of others) {
      warnings.push(
        o.s.end_time == null
          ? `Se solapa con la sesión en curso (desde el ${formatDate(o.start)} a las ${formatTime(o.start)}).`
          : `Se solapa con la sesión del ${formatDate(o.start)} de ${formatTime(o.start)} a ${formatTime(o.end)}.`,
      )
    }
    const dayKey = madridDateKey(start)
    const dayMs = (dayTotals(ctx.sessions, ctx.nowMs).get(dayKey) ?? 0) + (end - start)
    if (dayMs > DAY_WARN_HOURS * HOUR_MS) {
      warnings.push(
        `El ${formatDate(start)} sumaría ${formatDuration(dayMs)} en total, más de ${DAY_WARN_HOURS} h en un día.`,
      )
    }
  }

  return { errors, warnings }
}

/**
 * Valida el cierre ajustado de una sesión live olvidada:
 * inicio < fin < ahora, fin - inicio <= MAX_SESSION_HOURS, motivo >= MIN_REASON (y <= MAX_REASON).
 * Con `wall` (fecha y hora tecleadas en Madrid) avisa si caen en un cambio de hora.
 */
export function validateAdjustedStop(
  input: { end: Date; reason: string; wall?: { date: string; time: string } },
  ctx: { nowMs: number; start: Date },
): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []
  const endMs = input.end instanceof Date ? input.end.getTime() : Number.NaN
  const startMs = ctx.start.getTime()
  if (!Number.isFinite(endMs)) {
    errors.push('Indica una hora de fin válida.')
  } else {
    const wall = input.wall
    const wallDate = wall ? parseDateKey(wall.date) : null
    if (wall && wallDate && wallDate.year >= MIN_YEAR && parseTimeKey(wall.time)) {
      const kind = madridTimeKind(wall.date, wall.time)
      if (kind === 'inexistente') {
        warnings.push(
          `Las ${wall.time} del ${formatDateKey(wall.date)} no existen por el cambio de hora: se guardará como las ${madridTimeKey(endMs)}.`,
        )
      } else if (kind === 'repetida') {
        warnings.push(
          `Las ${wall.time} del ${formatDateKey(wall.date)} ocurren dos veces por el cambio de hora: comprueba que has elegido la correcta (la primera es en horario de verano; la segunda, en horario de invierno).`,
        )
      }
    }
    const d = endMs - startMs
    if (d <= 0) {
      errors.push(
        `La hora de fin (${formatDateTime(endMs)}) tiene que ser posterior al inicio de la sesión (${formatDateTime(startMs)}).`,
      )
    } else if (d > MAX_SESSION_MS) {
      errors.push(
        `Una sesión puede durar como máximo ${MAX_SESSION_HOURS} h: con fin el ${formatDateTime(endMs)} duraría ${formatDuration(d)}. El fin más tardío posible es el ${formatDateTime(startMs + MAX_SESSION_MS)}.`,
      )
    } else if (d > WARN_OPEN_HOURS * HOUR_MS) {
      warnings.push(`La sesión duraría ${formatDuration(d)}, más de ${WARN_OPEN_HOURS} h. Comprueba la hora de fin.`)
    }
    if (endMs >= ctx.nowMs) {
      errors.push(
        `La hora de fin (${formatDateTime(endMs)}) tiene que ser anterior a este momento (${formatDateTime(ctx.nowMs)}).`,
      )
    }
  }
  errors.push(...lengthErrors(cleanText(input.reason), 'El motivo del ajuste', MIN_REASON, MAX_REASON))
  return { errors, warnings }
}

/** Motivo de anulación: MIN_REASON..MAX_REASON caracteres (tras trim). */
export function validateVoidReason(reason: string): ValidationResult {
  return { errors: lengthErrors(cleanText(reason), 'El motivo de la anulación', MIN_REASON, MAX_REASON), warnings: [] }
}

/** Nota: <= MAX_NOTE; en manuales >= MIN_MANUAL_NOTE. */
export function validateNote(note: string, method: 'live' | 'manual'): ValidationResult {
  const min = method === 'manual' ? MIN_MANUAL_NOTE : 0
  const label = method === 'manual' ? 'La nota de una entrada manual' : 'La nota'
  return { errors: lengthErrors(cleanText(note), label, min, MAX_NOTE), warnings: [] }
}

/** Comentario: 1..MAX_COMMENT caracteres (tras trim). */
export function validateComment(text: string): ValidationResult {
  const t = cleanText(text)
  if (textLength(t) === 0) return { errors: ['Escribe un comentario antes de enviarlo.'], warnings: [] }
  return { errors: lengthErrors(t, 'El comentario', 1, MAX_COMMENT), warnings: [] }
}
