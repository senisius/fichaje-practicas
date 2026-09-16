// Funciones puras de la interfaz: aviso de backup, textos del historial de revisiones y recortes.
import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { SessionDoc } from '../types'
import { backupStatus } from './backup-status'
import { diffSession, FIELD_LABELS, missingRevisionsText, SNAPSHOT_FIELDS } from './revision-diff'
import { DAY_MS, parseWhole, truncateText } from './text'

describe('backupStatus', () => {
  const now = Date.parse('2026-09-16T10:00:00Z')
  const HOUR = 3_600_000

  it('avisa en cuanto pasan más de 10 días exactos, no un día después', () => {
    expect(backupStatus(now - 10 * DAY_MS, now)).toEqual({ ageDays: 10, stale: false })
    expect(backupStatus(now - 10 * DAY_MS - 1, now)).toEqual({ ageDays: 10, stale: true })
    expect(backupStatus(now - 10 * DAY_MS - 23 * HOUR, now)).toEqual({ ageDays: 10, stale: true })
    expect(backupStatus(now - 11 * DAY_MS, now)).toEqual({ ageDays: 11, stale: true })
  })

  it('reciente, sin copia o con fecha rara', () => {
    expect(backupStatus(now - 3 * DAY_MS, now)).toEqual({ ageDays: 3, stale: false })
    expect(backupStatus(now - HOUR, now)).toEqual({ ageDays: 0, stale: false })
    // Reloj del dispositivo atrasado: nunca "hace -1 días"
    expect(backupStatus(now + HOUR, now)).toEqual({ ageDays: 0, stale: false })
    expect(backupStatus(null, now)).toEqual({ ageDays: null, stale: true })
    expect(backupStatus(Number.NaN, now)).toEqual({ ageDays: null, stale: true })
  })
})

describe('historial de revisiones', () => {
  it('el estado anterior completo no muestra el uid ni la versión interna', () => {
    const keys = SNAPSHOT_FIELDS.map(([k]) => k)
    expect(keys).not.toContain('owner')
    expect(keys).not.toContain('rev')
    expect(keys).toEqual(FIELD_LABELS.map(([k]) => k).filter((k) => k !== 'owner' && k !== 'rev'))
  })

  it('el diff sigue comparando todos los campos útiles', () => {
    const t = Timestamp.fromMillis(Date.parse('2026-09-16T07:00:00Z'))
    const base: SessionDoc = {
      owner: 'uid-estudiante',
      method: 'live',
      start_time: t,
      end_time: null,
      adjusted: false,
      adjust_reason: '',
      voided: false,
      void_reason: '',
      note: '',
      rev: 0,
      created_at: t,
      updated_at: t,
    }
    const changes = diffSession(base, { ...base, note: 'Nueva', rev: 1 })
    expect(changes.map((c) => c.key)).toEqual(['note'])
  })

  it('aviso de revisiones que faltan con la concordancia correcta', () => {
    expect(missingRevisionsText(2, 1)).toBe('Constan 2 cambios, pero solo hay 1 revisión guardada.')
    expect(missingRevisionsText(3, 2)).toBe('Constan 3 cambios, pero solo hay 2 revisiones guardadas.')
    expect(missingRevisionsText(1, 0)).toBe('Consta 1 cambio, pero no hay ninguna revisión guardada.')
    expect(missingRevisionsText(2, 0)).toBe('Constan 2 cambios, pero no hay ninguna revisión guardada.')
  })
})

describe('textos', () => {
  it('truncateText recorta sin partir emojis', () => {
    expect(truncateText('  corta  ', 80)).toBe('corta')
    expect(truncateText('abcdef', 3)).toBe('abc…')
    expect(truncateText('ab cdef', 3)).toBe('ab…')
    expect(truncateText('📚📚📚📚', 2)).toBe('📚📚…')
    expect(truncateText('x'.repeat(2000), 80)).toHaveLength(81)
  })

  it('parseWhole: solo enteros; lo mal tecleado es NaN, no 0', () => {
    expect(parseWhole('')).toBe(0)
    expect(parseWhole(' 8 ')).toBe(8)
    for (const bad of ['8.', '8,5', '1e', '2-', '+1', '30m', '2h', '-3']) expect(parseWhole(bad), bad).toBeNaN()
  })
})
