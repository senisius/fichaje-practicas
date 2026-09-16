// Borrador local de la nota de la sesión en curso (K1).
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clearAllNoteDrafts,
  clearNoteDraft,
  listNoteDrafts,
  loadNoteDraft,
  noteDraftKey,
  saveNoteDraft,
} from './note-draft'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('borrador de la nota', () => {
  it('se guarda, se lee y se borra por id de sesión', () => {
    const storage = fakeStorage()
    vi.stubGlobal('localStorage', storage)
    expect(loadNoteDraft('s1')).toBeNull()
    saveNoteDraft('s1', 'Revisando expedientes')
    saveNoteDraft('s2', '')
    expect(storage.getItem(noteDraftKey('s1'))).toBe('Revisando expedientes')
    expect(noteDraftKey('s1')).toBe('fichaje-practicas:note:s1')
    expect(loadNoteDraft('s1')).toBe('Revisando expedientes')
    // Un borrador vacío también cuenta (el estudiante ha borrado la nota del servidor)
    expect(loadNoteDraft('s2')).toBe('')
    clearNoteDraft('s1')
    expect(loadNoteDraft('s1')).toBeNull()
  })

  it('lista y borra solo los borradores de esta app', () => {
    const storage = fakeStorage()
    storage.setItem('otra-clave', 'x')
    storage.setItem('fichaje-practicas:clock-sample', '{}')
    vi.stubGlobal('localStorage', storage)
    saveNoteDraft('a', 'uno')
    saveNoteDraft('b', 'dos')
    expect(listNoteDrafts()).toEqual([
      { sessionId: 'a', text: 'uno' },
      { sessionId: 'b', text: 'dos' },
    ])
    clearAllNoteDrafts()
    expect(listNoteDrafts()).toEqual([])
    expect(storage.getItem('otra-clave')).toBe('x')
    expect(storage.getItem('fichaje-practicas:clock-sample')).toBe('{}')
  })

  it('sin almacenamiento (Node, modo privado) no falla', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(loadNoteDraft('s1')).toBeNull()
    expect(() => saveNoteDraft('s1', 'x')).not.toThrow()
    expect(() => clearNoteDraft('s1')).not.toThrow()
    expect(listNoteDrafts()).toEqual([])
  })

  it('con un almacenamiento que lanza errores (bloqueado o lleno) no falla', () => {
    const broken = {
      get length(): number {
        throw new Error('bloqueado')
      },
      key: () => {
        throw new Error('bloqueado')
      },
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new DOMException('lleno', 'QuotaExceededError')
      },
      removeItem: () => {
        throw new Error('bloqueado')
      },
      clear: () => {},
    }
    vi.stubGlobal('localStorage', broken)
    expect(loadNoteDraft('s1')).toBeNull()
    expect(() => saveNoteDraft('s1', 'x')).not.toThrow()
    expect(() => clearNoteDraft('s1')).not.toThrow()
    expect(listNoteDrafts()).toEqual([])
    expect(() => clearAllNoteDrafts()).not.toThrow()
  })

  it('si acceder a localStorage lanza (cookies bloqueadas), tampoco falla', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('denegado', 'SecurityError')
      },
    })
    try {
      expect(loadNoteDraft('s1')).toBeNull()
      expect(() => saveNoteDraft('s1', 'x')).not.toThrow()
      expect(listNoteDrafts()).toEqual([])
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage
    }
  })
})
