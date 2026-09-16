import type { Timestamp } from 'firebase/firestore'

// Modelo de datos de Firestore. Ver docs/CONTRATO.md.

export type Role = 'student' | 'supervisor' | 'backup'

/** users/{uid} — se crea a mano en la consola; la app nunca escribe aquí. */
export interface UserDoc {
  role: Role
  name: string
  email?: string
  /** Solo en el documento del student. */
  target_hours?: number
  /** Solo en el documento del student: inicio real de las prácticas. */
  program_start?: Timestamp
}

export interface AppUser extends UserDoc {
  uid: string
}

export type Method = 'live' | 'manual'

/** sessions/{sid} */
export interface SessionDoc {
  owner: string
  method: Method
  start_time: Timestamp
  /** null = en curso */
  end_time: Timestamp | null
  /** true si el fin de una sesión live se tecleó a mano */
  adjusted: boolean
  adjust_reason: string
  /** Anulación irreversible */
  voided: boolean
  void_reason: string
  note: string
  /** Empieza en 0 y sube 1 en cada cambio */
  rev: number
  created_at: Timestamp
  updated_at: Timestamp
}

export interface Session extends SessionDoc {
  id: string
}

export type SessionStatus = 'en_curso' | 'cerrada' | 'anulada'

/** sessions/{sid}/revisions/{rev} — copia del estado ANTERIOR a cada cambio. */
export interface RevisionDoc {
  before: SessionDoc
  at: Timestamp
}

export interface Revision extends RevisionDoc {
  id: string
}

/** live/{uid} — cerrojo: existe solo mientras ese student tiene una sesión abierta. */
export interface LiveDoc {
  session_id: string
}

/** comments/{cid} — solo la supervisora los crea; nunca se editan ni se borran. */
export interface CommentDoc {
  session_id: string
  session_owner: string
  author_uid: string
  text: string
  created_at: Timestamp
}

export interface Comment extends CommentDoc {
  id: string
}

/** meta/backup — solo lo escribe la cuenta 'backup'. */
export interface BackupMeta {
  last_backup_at: Timestamp
  docs: number
}
