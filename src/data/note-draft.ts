// Borrador local de la nota de la sesión en curso (localStorage, por id de sesión).
// La nota solo llega al servidor al parar o con «Guardar nota»; el borrador evita perderla si se
// cierra o se recarga la app. Si el almacenamiento no está disponible, todo sigue funcionando sin él.

const PREFIX = 'fichaje-practicas:note:'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function noteDraftKey(sessionId: string): string {
  return `${PREFIX}${sessionId}`
}

/** Borrador guardado para esa sesión, o null. */
export function loadNoteDraft(sessionId: string): string | null {
  try {
    return storage()?.getItem(noteDraftKey(sessionId)) ?? null
  } catch {
    return null
  }
}

export function saveNoteDraft(sessionId: string, text: string): void {
  try {
    storage()?.setItem(noteDraftKey(sessionId), text)
  } catch {
    // Almacenamiento lleno o bloqueado: el borrador queda solo en memoria
  }
}

export function clearNoteDraft(sessionId: string): void {
  try {
    storage()?.removeItem(noteDraftKey(sessionId))
  } catch {
    // sin almacenamiento: nada que borrar
  }
}

/** Todos los borradores guardados en este navegador. */
export function listNoteDrafts(): { sessionId: string; text: string }[] {
  const out: { sessionId: string; text: string }[] = []
  try {
    const store = storage()
    if (!store) return out
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (!key?.startsWith(PREFIX)) continue
      const text = store.getItem(key)
      if (text !== null) out.push({ sessionId: key.slice(PREFIX.length), text })
    }
  } catch {
    // sin almacenamiento: no hay borradores
  }
  return out
}

/** Borra todos los borradores (al cerrar sesión: no deben quedar en un equipo compartido). */
export function clearAllNoteDrafts(): void {
  for (const d of listNoteDrafts()) clearNoteDraft(d.sessionId)
}
