// Diferencias legibles entre dos estados de una sesión (para el historial de revisiones).
import type { Timestamp } from 'firebase/firestore'
import { formatDateTime } from '../lib/time'
import type { SessionDoc } from '../types'
import { plural } from './text'

type Key = keyof SessionDoc

export interface FieldChange {
  key: Key
  label: string
  before: string
  after: string
  /** Texto largo (notas, motivos): se muestra en bloque en vez de en línea. */
  long: boolean
}

/** Orden y nombre de los campos que se comparan. rev y updated_at cambian siempre y no aportan. */
export const FIELD_LABELS: [Key, string][] = [
  ['start_time', 'Inicio'],
  ['end_time', 'Fin'],
  ['adjusted', 'Fin ajustado'],
  ['adjust_reason', 'Motivo del ajuste'],
  ['voided', 'Anulada'],
  ['void_reason', 'Motivo de anulación'],
  ['note', 'Nota'],
  ['method', 'Método'],
  ['owner', 'Propietario'],
  ['created_at', 'Registrada'],
  ['rev', 'Versión'],
  ['updated_at', 'Última modificación'],
]

const SKIP_IN_DIFF = new Set<Key>(['rev', 'updated_at'])

/**
 * Campos del "estado anterior completo". Sin `owner` (un uid técnico que las reglas no dejan cambiar)
 * ni `rev` (un contador interno que no dice nada a la profesora).
 */
export const SNAPSHOT_FIELDS: [Key, string][] = FIELD_LABELS.filter(([key]) => key !== 'owner' && key !== 'rev')
const LONG = new Set<Key>(['note', 'adjust_reason', 'void_reason'])

function isTimestamp(v: unknown): v is Timestamp {
  return typeof v === 'object' && v !== null && typeof (v as { toMillis?: unknown }).toMillis === 'function'
}

function same(a: unknown, b: unknown): boolean {
  if (isTimestamp(a) && isTimestamp(b)) return a.toMillis() === b.toMillis()
  return a === b
}

export function showValue(key: Key, v: unknown): string {
  if (v === null || v === undefined) return key === 'end_time' ? 'en curso' : '—'
  if (isTimestamp(v)) return formatDateTime(v)
  if (typeof v === 'boolean') return v ? 'sí' : 'no'
  if (key === 'method') return v === 'live' ? 'en vivo' : 'manual'
  if (typeof v === 'string') return v === '' ? '(vacío)' : v
  return String(v)
}

export function diffSession(before: SessionDoc, after: SessionDoc): FieldChange[] {
  const changes: FieldChange[] = []
  for (const [key, label] of FIELD_LABELS) {
    if (SKIP_IN_DIFF.has(key)) continue
    if (same(before[key], after[key])) continue
    changes.push({
      key,
      label,
      before: showValue(key, before[key]),
      after: showValue(key, after[key]),
      long: LONG.has(key),
    })
  }
  return changes
}

/** Resumen del tipo de cambio: "Parada", "Anulación", "Nota editada"… */
export function describeChange(before: SessionDoc, after: SessionDoc): string {
  if (before.end_time === null && after.end_time !== null) {
    return after.adjusted ? 'Parada con fin ajustado' : 'Parada'
  }
  if (!before.voided && after.voided) return 'Anulación'
  if (before.note !== after.note) return 'Nota editada'
  return 'Cambio'
}

/** "Constan 2 cambios, pero solo hay 1 revisión guardada." (con la concordancia correcta). */
export function missingRevisionsText(changes: number, saved: number): string {
  const verb = changes === 1 ? 'Consta' : 'Constan'
  const have =
    saved === 0
      ? 'no hay ninguna revisión guardada'
      : `solo hay ${plural(saved, 'revisión guardada', 'revisiones guardadas')}`
  return `${verb} ${plural(changes, 'cambio', 'cambios')}, pero ${have}.`
}
