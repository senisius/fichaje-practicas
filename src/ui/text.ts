// Textos y formatos de interfaz que no dependen de fechas (las fechas van siempre por lib/time.ts).
import type { Method, Role, SessionStatus } from '../types'

export const DISCLAIMER_LEAD = 'Herramienta personal, no oficial de la UAB.'
export const DISCLAIMER_WARNING = 'No uses aquí tu contraseña de la UAB.'
export const DISCLAIMER = `${DISCLAIMER_LEAD} ${DISCLAIMER_WARNING}`

/** Objetivo si el perfil del student no trae un target_hours válido (ver resolveTargetHours). */
export { DEFAULT_TARGET_HOURS } from '../lib/limits'

export const DAY_MS = 86_400_000

/** Longitud mínima que la interfaz exige a una contraseña nueva (la misma que api.ts). */
export { MIN_PASSWORD_LENGTH as MIN_PASSWORD } from '../lib/limits'

export function roleLabel(role: Role): string {
  switch (role) {
    case 'student':
      return 'Estudiante'
    case 'supervisor':
      return 'Supervisora'
    case 'backup':
      return 'Copias de seguridad'
  }
}

export function methodLabel(method: Method): string {
  return method === 'live' ? 'Fichaje en vivo' : 'Entrada manual'
}

export function statusLabel(status: SessionStatus): string {
  switch (status) {
    case 'en_curso':
      return 'En curso'
    case 'cerrada':
      return 'Cerrada'
    case 'anulada':
      return 'Anulada'
  }
}

/** "1 sesión", "3 sesiones". */
export function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString('es-ES')} ${n === 1 ? one : many}`
}

const pctFormat = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

/** "45,3 %" */
export function formatPct(pct: number): string {
  return `${pctFormat.format(Number.isFinite(pct) ? pct : 0)} %`
}

/** "298 h" si es entero; si no, "298,5 h". */
export function formatHours(hours: number): string {
  return `${hours.toLocaleString('es-ES', { maximumFractionDigits: 2 })} h`
}

/** Recorta un texto a `max` caracteres (sin partir emojis) y añade "…" si sobraba. */
export function truncateText(text: string, max: number): string {
  const chars = Array.from(text.trim())
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('').trimEnd()}…`
}

/** Iniciales para el avatar del menú. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length > 1 ? [parts[0], parts[parts.length - 1]] : parts
  return letters.map((p) => p.charAt(0).toLocaleUpperCase('es-ES')).join('') || '?'
}

/** Número entero no negativo a partir del texto de un campo numérico (type=text, inputMode=numeric); '' → 0; inválido → NaN. */
export function parseWhole(value: string): number {
  const v = value.trim()
  if (v === '') return 0
  if (!/^\d+$/.test(v)) return Number.NaN
  return Number(v)
}
