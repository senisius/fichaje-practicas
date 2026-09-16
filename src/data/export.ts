// Exportación CSV/JSON. Los totales usan progress(), igual que la barra de progreso.
import {
  HOUR_MS,
  MINUTE_MS,
  TZ,
  durationMs,
  formatDateShort,
  formatDateTime,
  formatDuration,
  formatHoursDecimal,
  formatPct,
  formatTime,
  madridDateKey,
  progress,
  resolveTargetHours,
  sessionStatus,
} from '../lib/time'
import type { AppUser, Comment, Session, SessionStatus } from '../types'

export interface ExportInput {
  sessions: Session[]
  comments: Comment[]
  users: AppUser[]
  nowMs: number
}

export const CSV_SEPARATOR = ';'
const BOM = '﻿'
const EOL = '\r\n'

export const CSV_COLUMNS = [
  'Fecha',
  'Inicio',
  'Fin',
  'Minutos',
  'Horas',
  'Método',
  'Estado',
  'Fin ajustado',
  'Motivo del ajuste',
  'Anulada',
  'Motivo de la anulación',
  'Nota',
  'Comentarios',
  'Registrada',
  'Id',
] as const

const STATUS_LABEL: Record<SessionStatus, string> = { en_curso: 'en curso', cerrada: 'cerrada', anulada: 'anulada' }
const METHOD_LABEL = { live: 'en vivo', manual: 'manual' } as const

/** Escapa un campo CSV: entre comillas si contiene separador, comillas, saltos de línea o espacios en los extremos. */
export function csvField(value: string | number): string {
  const s = String(value)
  if (/[";\r\n]/.test(s) || s !== s.trim()) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Texto que no genera la app (notas, motivos, ids, valores escritos desde la consola): evita que Excel
 * lo interprete como fórmula (=, +, -, @, tabulador o retorno al principio).
 */
function freeText(s: unknown): string {
  const text = String(s ?? '')
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

function row(values: (string | number)[]): string {
  return values.map(csvField).join(CSV_SEPARATOR)
}

function targetHoursOf(users: AppUser[]): number {
  return resolveTargetHours(users.find((u) => u.role === 'student')?.target_hours)
}

function sortedChronologically(sessions: Session[]): Session[] {
  return [...sessions].sort(
    (a, b) => a.start_time.toMillis() - b.start_time.toMillis() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  )
}

/**
 * CSV (separador ';', BOM UTF-8 para Excel en español) con una fila por sesión:
 * fecha local, inicio, fin, minutos, horas decimales, método, estado, fin ajustado + motivo,
 * anulada + motivo, nota, nº comentarios, registrada (created_at), id.
 * Última fila: total válido (mismo cálculo que la barra de progreso).
 *
 * Filas en orden cronológico. Las sesiones en curso no tienen fin ni duración. Si el fin cae en
 * otro día que el inicio, la columna Fin incluye la fecha. Minutos = minutos completos.
 */
export function buildCsv(input: ExportInput): string {
  const counts = new Map<string, number>()
  for (const c of input.comments) counts.set(c.session_id, (counts.get(c.session_id) ?? 0) + 1)

  const lines = [row([...CSV_COLUMNS])]
  for (const s of sortedChronologically(input.sessions)) {
    const open = s.end_time == null
    const ms = durationMs(s)
    let end = ''
    if (s.end_time != null) {
      end =
        madridDateKey(s.end_time) === madridDateKey(s.start_time) ? formatTime(s.end_time) : formatDateTime(s.end_time)
    }
    lines.push(
      row([
        formatDateShort(s.start_time),
        formatTime(s.start_time),
        end,
        open ? '' : Math.floor(ms / MINUTE_MS),
        open ? '' : formatHoursDecimal(ms),
        METHOD_LABEL[s.method] ?? freeText(s.method),
        STATUS_LABEL[sessionStatus(s)],
        s.adjusted ? 'sí' : 'no',
        freeText(s.adjust_reason),
        s.voided ? 'sí' : 'no',
        freeText(s.void_reason),
        freeText(s.note),
        counts.get(s.id) ?? 0,
        formatDateTime(s.created_at),
        freeText(s.id),
      ]),
    )
  }

  const target = targetHoursOf(input.users)
  const p = progress(input.sessions, target, null, input.nowMs)
  lines.push(
    row([
      'TOTAL VÁLIDO',
      '',
      '',
      Math.floor(p.doneMs / MINUTE_MS),
      formatHoursDecimal(p.doneMs),
      '',
      p.validCount === 1 ? '1 sesión válida' : `${p.validCount} sesiones válidas`,
      p.adjustedCount === 1 ? '1 ajustada' : `${p.adjustedCount} ajustadas`,
      '',
      '',
      '',
      `${formatDuration(p.doneMs)} de ${target} h (${formatPct(p.pct)}); exportado el ${formatDateTime(input.nowMs)} (hora de Madrid)`,
      input.comments.length,
      '',
      '',
    ]),
  )
  return BOM + lines.join(EOL) + EOL
}

/** Convierte recursivamente los Timestamp (y Date) a texto ISO 8601. */
function toPlain(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value === 'object' && value !== null) {
    const v = value as { toDate?: unknown }
    if (typeof v.toDate === 'function') return (v.toDate as () => Date).call(value).toISOString()
    const out: Record<string, unknown> = {}
    for (const [k, inner] of Object.entries(value)) out[k] = toPlain(inner)
    return out
  }
  return value
}

/** JSON completo (sesiones + comentarios + usuarios) con fechas en ISO 8601. */
export function buildJson(input: ExportInput): string {
  const target = targetHoursOf(input.users)
  const p = progress(input.sessions, target, null, input.nowMs)
  const data = {
    app: 'Fichaje Prácticas',
    exported_at: new Date(input.nowMs).toISOString(),
    timezone: TZ,
    summary: {
      target_hours: target,
      done_ms: p.doneMs,
      done_hours: Math.round((p.doneMs / HOUR_MS) * 100) / 100,
      done_minutes: Math.floor(p.doneMs / MINUTE_MS),
      manual_ms: p.manualMs,
      live_ms: p.liveMethodMs,
      valid_sessions: p.validCount,
      adjusted_sessions: p.adjustedCount,
      total_sessions: input.sessions.length,
      total_comments: input.comments.length,
    },
    users: [...input.users].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0)),
    sessions: sortedChronologically(input.sessions).map((s) => ({
      ...s,
      status: sessionStatus(s),
      duration_ms: s.end_time == null ? null : durationMs(s),
    })),
    comments: [...input.comments].sort(
      (a, b) => a.created_at.toMillis() - b.created_at.toMillis() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    ),
  }
  return JSON.stringify(toPlain(data), null, 2) + '\n'
}

/** Descarga un fichero en el navegador. */
export function downloadFile(filename: string, content: string, mime: string): void {
  const type = /charset=/i.test(mime) ? mime : `${mime};charset=utf-8`
  const url = URL.createObjectURL(new Blob([content], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Algunos navegadores necesitan que la URL siga viva un momento tras el clic
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/** "fichaje-2026-09-16.csv" */
export function exportFilename(ext: 'csv' | 'json', nowMs: number): string {
  return `fichaje-${madridDateKey(nowMs)}.${ext}`
}
