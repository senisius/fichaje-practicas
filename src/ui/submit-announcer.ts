import { useCallback, useState } from 'react'

/** Mensaje para una región aria-live; `n` cambia en cada anuncio para repetir el mismo texto. */
export interface Announcement {
  text: string
  n: number
}

/**
 * Anuncios de los formularios al enviar. Los errores que cambian con cada tecla (p. ej. "ahora tiene N
 * caracteres") no van en una región viva: se asocian a su campo y aquí solo se anuncia el resultado
 * de cada intento de envío (ver LiveMessage en Notice.tsx).
 */
export function useSubmitAnnouncer(): { announcement: Announcement; announce: (text: string) => void } {
  const [announcement, setAnnouncement] = useState<Announcement>({ text: '', n: 0 })
  const announce = useCallback((text: string) => setAnnouncement((a) => ({ text, n: a.n + 1 })), [])
  return { announcement, announce }
}
