import { useNow } from '../data/AppDataProvider'
import { BACKUP_STALE_DAYS } from '../lib/limits'
import { formatDateTime } from '../lib/time'
import type { BackupMeta, Role } from '../types'
import { IconAlert, IconDatabase } from './icons'
import { backupStatus } from './backup-status'
import { Skeleton } from './Notice'
import { plural } from './text'
import './cards.css'

export function BackupIndicator({ backup, loading, role }: { backup: BackupMeta | null; loading: boolean; role: Role }) {
  const nowMs = useNow(15 * 60_000)

  if (loading) {
    return (
      <div className="backup" aria-hidden="true">
        <Skeleton width="70%" height={14} />
      </div>
    )
  }

  const lastMs = backup?.last_backup_at?.toMillis() ?? null
  const { ageDays, stale } = backupStatus(lastMs, nowMs)
  const fixHint =
    role === 'student'
      ? 'Revisa el workflow de copias de seguridad en GitHub (se puede lanzar a mano) y exporta un CSV mientras tanto.'
      : 'Puedes exportar un CSV desde el menú de tu cuenta y avisar al estudiante.'

  return (
    <section className={stale ? 'backup is-stale' : 'backup'} aria-label="Copia de seguridad">
      {stale ? <IconAlert /> : <IconDatabase />}
      <div className="stack" style={{ gap: 2 }}>
        {backup && lastMs !== null ? (
          <p>
            Última copia de seguridad: <strong>{formatDateTime(backup.last_backup_at)}</strong>
            {ageDays !== null && ageDays > 0 && <> (hace {plural(ageDays, 'día', 'días')})</>}
            {typeof backup.docs === 'number' && <span className="muted"> · {plural(backup.docs, 'documento', 'documentos')}</span>}
          </p>
        ) : (
          <p>
            <strong>No consta ninguna copia de seguridad automática.</strong>
          </p>
        )}
        {stale && (
          <p className="small">
            {backup ? `Tiene más de ${BACKUP_STALE_DAYS} días. ` : ''}
            {fixHint}
          </p>
        )}
      </div>
    </section>
  )
}
