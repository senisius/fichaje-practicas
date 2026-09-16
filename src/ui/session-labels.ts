import { formatDate, formatTime, madridDateKey } from '../lib/time'
import type { Session } from '../types'

/** "09:00–13:30", con "(+1 d)" si termina al día siguiente y "aprox." en las manuales. */
export function scheduleLabel(s: Session): string {
  const from = formatTime(s.start_time)
  const to = s.end_time ? formatTime(s.end_time) : 'en curso'
  const nextDay = s.end_time !== null && madridDateKey(s.end_time) !== madridDateKey(s.start_time)
  return `${from}–${to}${nextDay ? ' (+1 d)' : ''}${s.method === 'manual' ? ' aprox.' : ''}`
}

/** Texto corto para identificar otra sesión: "09:00–13:00" si es del mismo día; si no, con fecha. */
export function otherSessionLabel(other: Session, sameDayAs: Session): string {
  const sameDay = madridDateKey(other.start_time) === madridDateKey(sameDayAs.start_time)
  return sameDay ? scheduleLabel(other) : `${formatDate(other.start_time)} ${formatTime(other.start_time)}`
}
