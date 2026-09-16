// Límites de negocio. Los marcados con (reglas) también los impone firestore.rules:
// si cambias uno, cambia la regla y su test.

/** (reglas) Duración máxima de cualquier sesión. */
export const MAX_SESSION_HOURS = 16
/** A partir de aquí la sesión abierta muestra un aviso de "¿olvidaste parar?". */
export const WARN_OPEN_HOURS = 10
/** (reglas) Una entrada manual puede empezar como mucho hace estos días (31 d = 744 h). */
export const MAX_BACKDATE_DAYS = 31
/** Hora por defecto de las entradas manuales sin hora (hora de Madrid). */
export const DEFAULT_MANUAL_TIME = '09:00'
/** (reglas) Nota mínima en entradas manuales. */
export const MIN_MANUAL_NOTE = 5
/** (reglas) Motivo mínimo para ajustar un fin o anular. */
export const MIN_REASON = 10
/** (reglas) Motivo máximo para ajustar un fin o anular. */
export const MAX_REASON = 500
/** (reglas) Longitud máxima de notas. */
export const MAX_NOTE = 2000
/** (reglas) Longitud máxima de comentarios. */
export const MAX_COMMENT = 2000
/** Un día con más horas que esto se marca para la supervisora. */
export const DAY_WARN_HOURS = 10
/** Una sesión registrada más de estas horas después de terminar se marca como tardía. */
export const LATE_FLAG_HOURS = 48
/** Si el último backup es más antiguo, la app avisa. */
export const BACKUP_STALE_DAYS = 10
/** Semanas usadas para estimar el ritmo y la fecha de fin. */
export const PACE_WEEKS = 4
/** Objetivo de horas si el perfil del student no trae un target_hours numérico válido. */
export const DEFAULT_TARGET_HOURS = 298
/** Longitud mínima de una contraseña nueva (api.ts y la interfaz). */
export const MIN_PASSWORD_LENGTH = 8
