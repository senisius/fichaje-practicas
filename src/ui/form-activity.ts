import { useEffect, useRef, type RefObject } from 'react'

/** Estado de un formulario incrustado en un panel: texto sin enviar y operación pendiente. */
export interface FormActivity {
  dirty: boolean
  busy: boolean
}

export const IDLE: FormActivity = { dirty: false, busy: false }

/**
 * Comunica al contenedor el estado del formulario (y lo limpia al desmontarse). Devuelve un ref que
 * indica si el formulario sigue montado, para avisar con un toast de un error que ya no se vería.
 * `onActivity` debe ser estable (useCallback).
 */
export function useFormActivity(
  activity: FormActivity,
  onActivity?: (activity: FormActivity) => void,
): RefObject<boolean> {
  const mounted = useRef(true)
  const { dirty, busy } = activity

  useEffect(() => {
    onActivity?.({ dirty, busy })
  }, [dirty, busy, onActivity])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      onActivity?.(IDLE)
    }
  }, [onActivity])

  return mounted
}
