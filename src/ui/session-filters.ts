import type { SessionFlags } from '../lib/time'
import type { Session } from '../types'

export type SessionFilter = 'all' | 'live' | 'manual' | 'marked' | 'voided'

export const FILTERS: { key: SessionFilter; label: string }[] = [
  { key: 'all', label: 'Todas' },
  { key: 'live', label: 'En vivo' },
  { key: 'manual', label: 'Manuales' },
  { key: 'marked', label: 'Con marcas' },
  { key: 'voided', label: 'Anuladas' },
]

/** Una sesión "tiene marcas" si algo en ella merece la atención de la supervisora. */
export function hasMarks(s: Session, f: SessionFlags | undefined): boolean {
  if (s.adjusted || s.voided) return true
  if (!f) return false
  return f.editCount > 0 || f.lateDays !== null || f.overlapsWith.length > 0 || f.dayOverLimit
}

export function matchesFilter(filter: SessionFilter, s: Session, f: SessionFlags | undefined): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'live':
      return s.method === 'live'
    case 'manual':
      return s.method === 'manual'
    case 'marked':
      return hasMarks(s, f)
    case 'voided':
      return s.voided
  }
}
