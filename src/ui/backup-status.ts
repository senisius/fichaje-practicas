import { BACKUP_STALE_DAYS } from '../lib/limits'
import { DAY_MS } from './text'

/**
 * Antigüedad del último backup. `ageDays` son días completos (para el texto "hace N días"); el aviso
 * salta en cuanto pasan más de BACKUP_STALE_DAYS días exactos, no al completar el día siguiente.
 */
export function backupStatus(lastMs: number | null, nowMs: number): { ageDays: number | null; stale: boolean } {
  if (lastMs === null || !Number.isFinite(lastMs)) return { ageDays: null, stale: true }
  const age = nowMs - lastMs
  return { ageDays: Math.max(0, Math.floor(age / DAY_MS)), stale: age > BACKUP_STALE_DAYS * DAY_MS }
}
