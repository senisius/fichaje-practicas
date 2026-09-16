import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { HOUR_MS, MINUTE_MS } from './time'
import {
  cleanText,
  manualInterval,
  storedLength,
  textLength,
  validateAdjustedStop,
  validateComment,
  validateManual,
  validateNote,
  validateVoidReason,
  type ManualInput,
} from './validation'

const ms = (iso: string): number => Date.parse(iso)
const ts = (iso: string): Timestamp => Timestamp.fromMillis(ms(iso))

function mk(id: string, start: string, end: string | null, extra: Partial<Session> = {}): Session {
  return {
    id,
    owner: 'stu',
    method: 'live',
    start_time: ts(start),
    end_time: end === null ? null : ts(end),
    adjusted: false,
    adjust_reason: '',
    voided: false,
    void_reason: '',
    note: '',
    rev: 0,
    created_at: ts(start),
    updated_at: ts(start),
    ...extra,
  }
}

// Miércoles 16-09-2026, 12:00 en Madrid
const NOW = ms('2026-09-16T10:00:00Z')
const PROGRAM_START = new Date('2026-07-01T07:00:00Z')
const ctx = (over: Partial<Parameters<typeof validateManual>[1]> = {}) => ({
  nowMs: NOW,
  programStart: PROGRAM_START,
  sessions: [] as Session[],
  ...over,
})
const input = (over: Partial<ManualInput> = {}): ManualInput => ({
  date: '2026-09-15',
  minutes: 120,
  note: 'Informe semanal',
  ...over,
})

describe('utilidades de texto', () => {
  it('cleanText recorta y acepta null/undefined', () => {
    expect(cleanText('  hola \n')).toBe('hola')
    expect(cleanText(undefined)).toBe('')
    expect(cleanText(null)).toBe('')
  })

  it('cleanText quita también lo que quitaría el trim() de las reglas (controles <= U+0020)', () => {
    expect(cleanText('\x01abcd\x1f')).toBe('abcd')
    expect(cleanText(' 　hola ﻿')).toBe('hola')
    expect(cleanText('a \x01 b')).toBe('a \x01 b')
    expect(cleanText('\x00\t\x0b')).toBe('')
  })

  it('storedLength cuenta unidades UTF-16, como size() en el emulador y maxlength', () => {
    expect(storedLength('abc')).toBe(3)
    expect(storedLength('\u{1F600}\u{1F600}')).toBe(4)
    expect(storedLength('ñ')).toBe(1)
  })

  it('textLength cuenta puntos de código', () => {
    expect(textLength('abc')).toBe(3)
    expect(textLength('😀😀')).toBe(2)
    expect(textLength('ñáü')).toBe(3)
  })
})

describe('validateManual', () => {
  it('acepta una entrada normal sin avisos y usa 09:00 por defecto', () => {
    const r = validateManual(input(), ctx())
    expect(r).toEqual({ errors: [], warnings: [] })
    expect(manualInterval(input())).toEqual({
      start: ms('2026-09-15T07:00:00Z'),
      end: ms('2026-09-15T09:00:00Z'),
    })
    expect(manualInterval(input({ time: '' }))!.start).toBe(ms('2026-09-15T07:00:00Z'))
    expect(manualInterval(input({ time: '  ' }))!.start).toBe(ms('2026-09-15T07:00:00Z'))
    expect(manualInterval(input({ time: '16:30' }))!.start).toBe(ms('2026-09-15T14:30:00Z'))
  })

  it('duración: 16 h justas vale, 16 h 01 min no', () => {
    expect(validateManual(input({ date: '2026-09-14', time: '06:00', minutes: 960 }), ctx()).errors).toEqual([])
    const r = validateManual(input({ date: '2026-09-14', time: '06:00', minutes: 961 }), ctx())
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('16 h')
    expect(r.errors[0]).toContain('16 h 01 min')
  })

  it('duración: entero >= 1', () => {
    for (const minutes of [0, -5, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const r = validateManual(input({ minutes }), ctx())
      expect(r.errors, String(minutes)).toHaveLength(1)
      expect(r.errors[0]).toMatch(/número entero de minutos mayor que 0/)
      expect(r.warnings).toEqual([])
    }
    expect(validateManual(input({ minutes: 1 }), ctx()).errors).toEqual([])
  })

  it('fin <= ahora (terminar justo ahora vale)', () => {
    // 11:00 Madrid + 60 min = 12:00 = ahora
    expect(validateManual(input({ date: '2026-09-16', time: '11:00', minutes: 60 }), ctx()).errors).toEqual([])
    const r = validateManual(input({ date: '2026-09-16', time: '11:00', minutes: 61 }), ctx())
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('futuro')
    expect(r.errors[0]).toContain('16/09/2026 12:01')
    expect(r.errors[0]).toContain('16/09/2026 12:00')
    expect(validateManual(input({ date: '2026-09-17' }), ctx()).errors[0]).toContain('futuro')
  })

  it('máximo 31 días atrás = 744 h exactas', () => {
    // ahora - 744 h = 16-08-2026 12:00 Madrid
    expect(validateManual(input({ date: '2026-08-16', time: '12:00', minutes: 30 }), ctx()).errors).toEqual([])
    const r = validateManual(input({ date: '2026-08-16', time: '11:59', minutes: 30 }), ctx())
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('31 días')
    expect(r.errors[0]).toContain('16/08/2026 11:59')
    expect(r.errors[0]).toContain('16/08/2026 12:00')
    // Con un "ahora" con segundos, el límite es exacto al milisegundo
    const now2 = ms('2026-09-16T10:00:00Z') - 1
    expect(validateManual(input({ date: '2026-08-16', time: '12:00', minutes: 30 }), ctx({ nowMs: now2 })).errors).toEqual([])
    const now3 = ms('2026-09-16T10:00:00Z') + 1
    expect(validateManual(input({ date: '2026-08-16', time: '12:00', minutes: 30 }), ctx({ nowMs: now3 })).errors).toHaveLength(1)
  })

  it('no antes del inicio de las prácticas', () => {
    const programStart = new Date('2026-09-01T07:00:00Z') // 09:00 Madrid
    expect(validateManual(input({ date: '2026-09-01', time: '09:00' }), ctx({ programStart })).errors).toEqual([])
    const r = validateManual(input({ date: '2026-09-01', time: '08:59' }), ctx({ programStart }))
    expect(r.errors).toHaveLength(1)
    expect(r.errors[0]).toContain('inicio de las prácticas')
    expect(r.errors[0]).toContain('01/09/2026 09:00')
    // Sin programStart no hay límite inferior (salvo los 31 días)
    expect(validateManual(input({ date: '2026-09-01', time: '08:59' }), ctx({ programStart: null })).errors).toEqual([])
  })

  it('nota obligatoria: 5–2000 caracteres tras recortar', () => {
    const short = validateManual(input({ note: '  abc  ' }), ctx())
    expect(short.errors).toEqual(['La nota (qué has hecho) debe tener al menos 5 caracteres (ahora tiene 3).'])
    const empty = validateManual(input({ note: '   ' }), ctx())
    expect(empty.errors).toEqual(['La nota (qué has hecho) es obligatoria: escribe al menos 5 caracteres.'])
    expect(validateManual(input({ note: '  abcde ' }), ctx()).errors).toEqual([])
    expect(validateManual(input({ note: 'x'.repeat(2000) }), ctx()).errors).toEqual([])
    const long = validateManual(input({ note: 'x'.repeat(2001) }), ctx())
    expect(long.errors).toEqual(['La nota (qué has hecho) puede tener como máximo 2000 caracteres (ahora tiene 2001).'])
    // Emojis: 4 puntos de código (8 unidades UTF-16) no llegan a 5
    expect(validateManual(input({ note: '😀😀😀😀' }), ctx()).errors).toHaveLength(1)
    expect(validateManual(input({ note: '😀😀😀😀😀' }), ctx()).errors).toEqual([])
    // El máximo se mide en unidades UTF-16 (un emoji ocupa 2), como size() en el emulador
    const emoji = '\u{1F600}'
    expect(validateManual(input({ note: emoji.repeat(1000) }), ctx()).errors).toEqual([])
    expect(validateManual(input({ note: emoji.repeat(1001) }), ctx()).errors).toEqual([
      'La nota (qué has hecho) puede tener como máximo 2000 caracteres (ahora ocupa 2002: los emojis y algunos símbolos cuentan como 2).',
    ])
    // Un carácter de control en un extremo no cuenta para el mínimo (el trim() de las reglas lo quita)
    expect(validateManual(input({ note: 'abcd\x01' }), ctx()).errors).toHaveLength(1)
  })

  it('fecha y hora no válidas', () => {
    expect(validateManual(input({ date: '' }), ctx()).errors).toEqual(['Indica la fecha.'])
    expect(validateManual(input({ date: '2026-02-30' }), ctx()).errors[0]).toContain('"2026-02-30" no es válida')
    expect(validateManual(input({ time: '25:00' }), ctx()).errors[0]).toContain('"25:00" no es válida')
    // Sin fecha válida no hay avisos
    expect(validateManual(input({ date: 'x' }), ctx({ sessions: [mk('a', '2026-09-15T07:00:00Z', '2026-09-15T08:00:00Z')] })).warnings).toEqual([])
  })

  it('acumula varios errores a la vez', () => {
    const r = validateManual({ date: '2026-09-17', time: '10:00', minutes: 1000, note: 'ab' }, ctx())
    expect(r.errors).toHaveLength(3)
  })

  it('avisa de solapes con sesiones no anuladas (tocarse no cuenta)', () => {
    const sessions = [
      mk('a', '2026-09-15T07:30:00Z', '2026-09-15T08:30:00Z'), // 09:30–10:30 Madrid
      mk('v', '2026-09-15T07:00:00Z', '2026-09-15T09:00:00Z', { voided: true }),
      mk('t', '2026-09-15T06:00:00Z', '2026-09-15T07:00:00Z'), // termina justo a las 09:00
      mk('n', '2026-09-15T09:00:00Z', '2026-09-15T10:00:00Z'), // empieza justo a las 11:00
    ]
    const r = validateManual(input(), ctx({ sessions }))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual(['Se solapa con la sesión del mar 15/09/2026 de 09:30 a 10:30.'])
  })

  it('avisa de solape con la sesión en curso (cuenta hasta ahora)', () => {
    const sessions = [mk('o', '2026-09-16T06:00:00Z', null)] // en curso desde las 08:00
    const r = validateManual(input({ date: '2026-09-16', time: '09:00', minutes: 60 }), ctx({ sessions }))
    expect(r.errors).toEqual([])
    expect(r.warnings[0]).toBe('Se solapa con la sesión en curso (desde el mié 16/09/2026 a las 08:00).')
  })

  it('avisa si el día supera 10 h (10 h justas no)', () => {
    const sessions = [mk('a', '2026-09-15T11:00:00Z', '2026-09-15T19:00:00Z')] // 8 h, 13:00–21:00
    expect(validateManual(input({ minutes: 120 }), ctx({ sessions })).warnings).toEqual([])
    const r = validateManual(input({ minutes: 121 }), ctx({ sessions }))
    expect(r.errors).toEqual([])
    expect(r.warnings).toEqual(['El mar 15/09/2026 sumaría 10 h 01 min en total, más de 10 h en un día.'])
    // Las anuladas no suman
    const withVoid = [...sessions, mk('v', '2026-09-15T05:00:00Z', '2026-09-15T06:00:00Z', { voided: true })]
    expect(validateManual(input({ minutes: 120 }), ctx({ sessions: withVoid })).warnings).toEqual([])
    // Una sesión propia de 10 h 01 min ya avisa sola
    expect(validateManual(input({ minutes: 601 }), ctx()).warnings).toHaveLength(1)
  })

  it('el día del aviso es el de Madrid', () => {
    const sessions = [
      mk('a', '2026-09-14T21:30:00Z', '2026-09-14T22:29:00Z'), // 23:30 del 14 en Madrid: no cuenta para el 15
      mk('b', '2026-09-14T22:30:00Z', '2026-09-14T23:30:00Z'), // 00:30 del 15 en Madrid (14 en UTC): sí cuenta
    ]
    expect(validateManual(input({ minutes: 540 }), ctx({ sessions })).warnings).toEqual([])
    expect(validateManual(input({ minutes: 541 }), ctx({ sessions })).warnings).toEqual([
      'El mar 15/09/2026 sumaría 10 h 01 min en total, más de 10 h en un día.',
    ])
  })

  it('un año mal tecleado ("0026") da un error claro y ningún aviso de cambio de hora', () => {
    const r = validateManual(input({ date: '0026-09-16', time: '09:00', minutes: 30 }), ctx())
    expect(r.errors).toEqual(['Revisa el año de la fecha (16/09/0026).'])
    expect(r.warnings).toEqual([])
    expect(validateManual(input({ date: '1999-12-31', minutes: 30 }), ctx()).errors).toEqual([
      'Revisa el año de la fecha (31/12/1999).',
    ])
    // Desde el 2000 se valida con normalidad (aquí falla por ser anterior al inicio de las prácticas)
    expect(validateManual(input({ date: '2000-01-01', minutes: 30 }), ctx()).errors[0]).toMatch(/inicio de las prácticas/)
  })

  it('avisa de horas repetidas o inexistentes por el cambio de hora', () => {
    const autumn = validateManual(
      input({ date: '2026-10-25', time: '02:30', minutes: 30 }),
      ctx({ nowMs: ms('2026-10-26T10:00:00Z') }),
    )
    expect(autumn.errors).toEqual([])
    expect(autumn.warnings).toEqual([
      'Las 02:30 del 25/10/2026 ocurren dos veces por el cambio de hora: se tomará la primera (horario de verano).',
    ])
    const spring = validateManual(
      input({ date: '2027-03-28', time: '02:30', minutes: 30 }),
      ctx({ nowMs: ms('2027-03-29T10:00:00Z') }),
    )
    expect(spring.errors).toEqual([])
    expect(spring.warnings).toEqual([
      'Las 02:30 del 28/03/2027 no existen por el cambio de hora: se guardará como las 03:30.',
    ])
    expect(manualInterval(input({ date: '2027-03-28', time: '02:30', minutes: 30 }))).toEqual({
      start: ms('2027-03-28T01:30:00Z'),
      end: ms('2027-03-28T02:00:00Z'),
    })
  })
})

describe('validateAdjustedStop', () => {
  const start = new Date('2026-09-16T06:00:00Z') // 08:00 Madrid
  const reason = 'Olvidé parar al salir'

  it('acepta un fin entre el inicio y ahora', () => {
    const r = validateAdjustedStop({ end: new Date('2026-09-16T09:00:00Z'), reason }, { nowMs: NOW, start })
    expect(r).toEqual({ errors: [], warnings: [] })
  })

  it('fin posterior al inicio', () => {
    const same = validateAdjustedStop({ end: new Date(start), reason }, { nowMs: NOW, start })
    expect(same.errors).toHaveLength(1)
    expect(same.errors[0]).toContain('posterior al inicio')
    const before = validateAdjustedStop({ end: new Date(start.getTime() - MINUTE_MS), reason }, { nowMs: NOW, start })
    expect(before.errors[0]).toContain('posterior al inicio')
    expect(validateAdjustedStop({ end: new Date(start.getTime() + 1), reason }, { nowMs: NOW, start }).errors).toEqual([])
  })

  it('fin estrictamente anterior a ahora', () => {
    const atNow = validateAdjustedStop({ end: new Date(NOW), reason }, { nowMs: NOW, start })
    expect(atNow.errors).toHaveLength(1)
    expect(atNow.errors[0]).toContain('anterior a este momento')
    expect(validateAdjustedStop({ end: new Date(NOW - 1), reason }, { nowMs: NOW, start }).errors).toEqual([])
  })

  it('máximo 16 h: 16 h justas vale (con aviso), 1 ms más no', () => {
    const oldStart = new Date('2026-09-15T06:00:00Z') // 08:00 del 15
    const exact = validateAdjustedStop(
      { end: new Date(oldStart.getTime() + 16 * HOUR_MS), reason },
      { nowMs: NOW, start: oldStart },
    )
    expect(exact.errors).toEqual([])
    expect(exact.warnings).toEqual(['La sesión duraría 16 h 00 min, más de 10 h. Comprueba la hora de fin.'])
    const over = validateAdjustedStop(
      { end: new Date(oldStart.getTime() + 16 * HOUR_MS + 1), reason },
      { nowMs: NOW, start: oldStart },
    )
    expect(over.errors).toHaveLength(1)
    expect(over.errors[0]).toContain('como máximo 16 h')
    expect(over.errors[0]).toContain('16/09/2026 00:00')
  })

  it('motivo 10–500 caracteres tras recortar', () => {
    const end = new Date('2026-09-16T09:00:00Z')
    expect(validateAdjustedStop({ end, reason: '  123456789  ' }, { nowMs: NOW, start }).errors).toEqual([
      'El motivo del ajuste debe tener al menos 10 caracteres (ahora tiene 9).',
    ])
    expect(validateAdjustedStop({ end, reason: '' }, { nowMs: NOW, start }).errors).toEqual([
      'El motivo del ajuste es obligatorio: escribe al menos 10 caracteres.',
    ])
    expect(validateAdjustedStop({ end, reason: '1234567890' }, { nowMs: NOW, start }).errors).toEqual([])
    expect(validateAdjustedStop({ end, reason: 'x'.repeat(500) }, { nowMs: NOW, start }).errors).toEqual([])
    expect(validateAdjustedStop({ end, reason: 'x'.repeat(501) }, { nowMs: NOW, start }).errors).toEqual([
      'El motivo del ajuste puede tener como máximo 500 caracteres (ahora tiene 501).',
    ])
  })

  it('fecha no válida', () => {
    const r = validateAdjustedStop({ end: new Date(Number.NaN), reason }, { nowMs: NOW, start })
    expect(r.errors).toEqual(['Indica una hora de fin válida.'])
  })
})

describe('validateAdjustedStop: cambio de hora', () => {
  const reason = 'Olvidé parar la noche del cambio de hora'
  const start = new Date('2026-10-24T23:30:00Z') // 01:30 del 25 (horario de verano)
  const nowMs = ms('2026-10-25T10:00:00Z')

  it('avisa de la hora repetida de octubre si se indica la hora tecleada', () => {
    const first = validateAdjustedStop(
      { end: new Date('2026-10-25T00:30:00Z'), reason, wall: { date: '2026-10-25', time: '02:30' } },
      { nowMs, start },
    )
    expect(first.errors).toEqual([])
    expect(first.warnings).toEqual([
      'Las 02:30 del 25/10/2026 ocurren dos veces por el cambio de hora: comprueba que has elegido la correcta (la primera es en horario de verano; la segunda, en horario de invierno).',
    ])
    // Sin la hora tecleada no se puede saber: sin aviso (compatible con las llamadas de api.ts)
    expect(validateAdjustedStop({ end: new Date('2026-10-25T00:30:00Z'), reason }, { nowMs, start }).warnings).toEqual([])
  })

  it('avisa de la hora inexistente de marzo con la hora que se guardará', () => {
    const r = validateAdjustedStop(
      { end: new Date('2027-03-28T01:30:00Z'), reason, wall: { date: '2027-03-28', time: '02:30' } },
      { nowMs: ms('2027-03-28T10:00:00Z'), start: new Date('2027-03-27T23:00:00Z') },
    )
    expect(r.warnings).toEqual(['Las 02:30 del 28/03/2027 no existen por el cambio de hora: se guardará como las 03:30.'])
  })

  it('sin avisos en horas normales ni con años mal tecleados', () => {
    const normal = validateAdjustedStop(
      { end: new Date('2026-10-25T08:00:00Z'), reason, wall: { date: '2026-10-25', time: '09:00' } },
      { nowMs, start },
    )
    expect(normal.warnings).toEqual([])
    const typo = validateAdjustedStop(
      { end: new Date('0026-10-25T00:30:00Z'), reason, wall: { date: '0026-10-25', time: '02:30' } },
      { nowMs, start },
    )
    expect(typo.warnings).toEqual([])
    expect(typo.errors[0]).toMatch(/posterior al inicio/)
  })
})

describe('validateVoidReason / validateNote / validateComment', () => {
  it('motivo de anulación 10–500', () => {
    expect(validateVoidReason('corto').errors).toEqual([
      'El motivo de la anulación debe tener al menos 10 caracteres (ahora tiene 5).',
    ])
    expect(validateVoidReason('   ').errors[0]).toContain('es obligatorio')
    expect(validateVoidReason(' Duplicada por error ').errors).toEqual([])
    expect(validateVoidReason('x'.repeat(500)).errors).toEqual([])
    expect(validateVoidReason('x'.repeat(501)).errors).toHaveLength(1)
  })

  it('nota: live sin mínimo, manual >= 5, ambas <= 2000', () => {
    expect(validateNote('', 'live').errors).toEqual([])
    expect(validateNote('   ', 'live').errors).toEqual([])
    expect(validateNote('x'.repeat(2000), 'live').errors).toEqual([])
    expect(validateNote('x'.repeat(2001), 'live').errors).toEqual([
      'La nota puede tener como máximo 2000 caracteres (ahora tiene 2001).',
    ])
    expect(validateNote(' abcd ', 'manual').errors).toEqual([
      'La nota de una entrada manual debe tener al menos 5 caracteres (ahora tiene 4).',
    ])
    expect(validateNote('', 'manual').errors[0]).toContain('es obligatoria')
    expect(validateNote('abcde', 'manual').errors).toEqual([])
    expect(validateNote('x'.repeat(2001), 'manual').errors).toHaveLength(1)
  })

  it('comentario 1–2000', () => {
    expect(validateComment('').errors).toEqual(['Escribe un comentario antes de enviarlo.'])
    expect(validateComment(' \n ').errors).toEqual(['Escribe un comentario antes de enviarlo.'])
    expect(validateComment('a').errors).toEqual([])
    expect(validateComment('x'.repeat(2000)).errors).toEqual([])
    expect(validateComment('x'.repeat(2001)).errors).toEqual([
      'El comentario puede tener como máximo 2000 caracteres (ahora tiene 2001).',
    ])
  })
})
