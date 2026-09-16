import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  WEEK_MS,
  addDaysKey,
  computeFlags,
  displayPct,
  displayRemainingMs,
  durationMs,
  editCountOf,
  effectiveInterval,
  estimateFinish,
  formatClock,
  formatDate,
  formatDateTime,
  formatDuration,
  formatHoursDecimal,
  formatPct,
  formatTime,
  formatTimeSeconds,
  formatWeekLabel,
  groupByWeek,
  isoWeekday,
  madridDateKey,
  madridTimeKey,
  madridTimeKind,
  madridToUtc,
  madridToUtcOptions,
  progress,
  resolveTargetHours,
  sessionStatus,
  weekStartKey,
} from './time'

const ms = (iso: string): number => {
  const v = Date.parse(iso)
  if (Number.isNaN(v)) throw new Error(`fecha de test no válida: ${iso}`)
  return v
}
const ts = (iso: string): Timestamp => Timestamp.fromMillis(ms(iso))

let seq = 0
interface Opts {
  id?: string
  start: string
  end?: string | null
  method?: 'live' | 'manual'
  voided?: boolean
  adjusted?: boolean
  rev?: number
  created?: string
  note?: string
}
function mk(o: Opts): Session {
  const end = o.end === undefined ? null : o.end
  return {
    id: o.id ?? `s${++seq}`,
    owner: 'stu',
    method: o.method ?? 'live',
    start_time: ts(o.start),
    end_time: end === null ? null : ts(end),
    adjusted: o.adjusted ?? false,
    adjust_reason: o.adjusted ? 'Olvidé parar el fichaje' : '',
    voided: o.voided ?? false,
    void_reason: o.voided ? 'Registrada por error' : '',
    note: o.note ?? '',
    rev: o.rev ?? 0,
    created_at: ts(o.created ?? o.start),
    updated_at: ts(o.created ?? o.start),
  }
}

describe('entorno de test', () => {
  it('se ejecuta en una zona distinta de Madrid (America/New_York)', () => {
    // 1 de julio: Nueva York está en UTC-4 (240 min); Madrid estaría en UTC+2 (-120)
    expect(new Date(2026, 6, 1).getTimezoneOffset()).toBe(240)
  })
})

describe('sessionStatus y durationMs', () => {
  it('deriva el estado', () => {
    expect(sessionStatus(mk({ start: '2026-09-15T07:00:00Z' }))).toBe('en_curso')
    expect(sessionStatus(mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z' }))).toBe('cerrada')
    expect(sessionStatus(mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z', voided: true }))).toBe(
      'anulada',
    )
  })

  it('calcula la duración (0 en curso, también en anuladas)', () => {
    expect(durationMs(mk({ start: '2026-09-15T07:00:00Z' }))).toBe(0)
    expect(durationMs(mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T11:08:00Z' }))).toBe(4 * HOUR_MS + 8 * MINUTE_MS)
    expect(durationMs(mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z', voided: true }))).toBe(HOUR_MS)
  })

  it('la duración a través del cambio de hora es la resta real de instantes', () => {
    // 25-10-2026: de 01:00 CEST a 04:00 CET son 4 h reales
    const s = mk({ start: '2026-10-24T23:00:00Z', end: '2026-10-25T03:00:00Z' })
    expect(madridTimeKey(s.start_time)).toBe('01:00')
    expect(madridTimeKey(s.end_time!)).toBe('04:00')
    expect(durationMs(s)).toBe(4 * HOUR_MS)
    // 28-03-2027: de 01:00 CET a 04:00 CEST son 2 h reales
    const t = mk({ start: '2027-03-28T00:00:00Z', end: '2027-03-28T02:00:00Z' })
    expect(madridTimeKey(t.start_time)).toBe('01:00')
    expect(madridTimeKey(t.end_time!)).toBe('04:00')
    expect(durationMs(t)).toBe(2 * HOUR_MS)
  })
})

describe('formatos', () => {
  it('formatDuration', () => {
    expect(formatDuration(0)).toBe('0 h 00 min')
    expect(formatDuration(5 * MINUTE_MS)).toBe('0 h 05 min')
    expect(formatDuration(4 * HOUR_MS + 8 * MINUTE_MS + 59_999)).toBe('4 h 08 min')
    expect(formatDuration(298 * HOUR_MS)).toBe('298 h 00 min')
    expect(formatDuration(59_999)).toBe('0 h 00 min')
    expect(formatDuration(-5 * MINUTE_MS)).toBe('0 h 00 min')
    expect(formatDuration(Number.NaN)).toBe('0 h 00 min')
  })

  it('formatClock', () => {
    expect(formatClock(0)).toBe('00:00:00')
    expect(formatClock(999)).toBe('00:00:00')
    expect(formatClock(HOUR_MS + 2 * MINUTE_MS + 3000)).toBe('01:02:03')
    expect(formatClock(100 * HOUR_MS + 59_000)).toBe('100:00:59')
    expect(formatClock(-1000)).toBe('00:00:00')
  })

  it('horas decimales y porcentaje con coma', () => {
    expect(formatHoursDecimal(4 * HOUR_MS + 5 * MINUTE_MS)).toBe('4,08')
    expect(formatHoursDecimal(-1)).toBe('0,00')
    expect(formatPct(63.44)).toBe('63,4 %')
    expect(formatPct(100)).toBe('100,0 %')
  })

  it('formatDate / formatTime / formatDateTime en hora de Madrid con cualquier DateLike', () => {
    const iso = '2026-09-14T07:05:00Z' // lunes 09:05 en Madrid (CEST)
    for (const d of [ms(iso), new Date(iso), ts(iso)]) {
      expect(formatDate(d)).toBe('lun 14/09/2026')
      expect(formatTime(d)).toBe('09:05')
      expect(formatDateTime(d)).toBe('14/09/2026 09:05')
    }
    // 22:30Z del domingo = 00:30 del lunes en Madrid (en Nueva York aún sería domingo)
    expect(formatDate(ms('2026-09-13T22:30:00Z'))).toBe('lun 14/09/2026')
    expect(formatTime(ms('2026-09-13T22:30:00Z'))).toBe('00:30')
    // Invierno (CET, +01:00) y todos los días de la semana
    expect(formatDateTime(ms('2026-12-31T23:59:00Z'))).toBe('01/01/2027 00:59')
    const days = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']
    days.forEach((name, i) => expect(formatDate(ms('2026-09-14T10:00:00Z') + i * DAY_MS)).toBe(`${name} ${14 + i}/09/2026`))
  })

  it('formatWeekLabel', () => {
    expect(formatWeekLabel('2026-09-14')).toBe('Semana del 14/09/2026')
  })
})

describe('fechas civiles de Madrid', () => {
  it('madridDateKey cambia de día en la medianoche de Madrid, no en la UTC ni en la del proceso', () => {
    expect(madridDateKey(ms('2026-09-15T21:59:59.999Z'))).toBe('2026-09-15')
    expect(madridDateKey(ms('2026-09-15T22:00:00Z'))).toBe('2026-09-16')
    expect(madridDateKey(ms('2026-12-31T22:59:59Z'))).toBe('2026-12-31')
    expect(madridDateKey(ms('2026-12-31T23:00:00Z'))).toBe('2027-01-01')
    expect(madridTimeKey(ms('2026-12-31T23:00:00Z'))).toBe('00:00')
  })

  it('madridTimeKey alrededor de los cambios de hora', () => {
    expect(madridTimeKey(ms('2026-10-25T00:30:00Z'))).toBe('02:30') // primera vez (CEST)
    expect(madridTimeKey(ms('2026-10-25T01:30:00Z'))).toBe('02:30') // segunda vez (CET)
    expect(madridTimeKey(ms('2027-03-28T00:59:00Z'))).toBe('01:59')
    expect(madridTimeKey(ms('2027-03-28T01:00:00Z'))).toBe('03:00')
  })

  it('madridToUtc en verano, invierno y medianoche', () => {
    expect(madridToUtc('2026-09-16', '09:00').toISOString()).toBe('2026-09-16T07:00:00.000Z')
    expect(madridToUtc('2026-12-15', '09:00').toISOString()).toBe('2026-12-15T08:00:00.000Z')
    expect(madridToUtc('2026-09-16', '00:00').toISOString()).toBe('2026-09-15T22:00:00.000Z')
    expect(madridToUtc('2027-01-01', '00:00').toISOString()).toBe('2026-12-31T23:00:00.000Z')
    expect(madridToUtc('2026-09-16', '23:59').toISOString()).toBe('2026-09-16T21:59:00.000Z')
    expect(madridToUtc('2028-02-29', '12:00').toISOString()).toBe('2028-02-29T11:00:00.000Z')
  })

  it('hora inexistente (28-03-2027, 02:00–02:59): avanza lo que dura el salto', () => {
    expect(madridToUtc('2027-03-28', '01:59').toISOString()).toBe('2027-03-28T00:59:00.000Z')
    expect(madridToUtc('2027-03-28', '02:00').toISOString()).toBe('2027-03-28T01:00:00.000Z')
    expect(madridToUtc('2027-03-28', '02:30').toISOString()).toBe('2027-03-28T01:30:00.000Z')
    expect(madridToUtc('2027-03-28', '02:59').toISOString()).toBe('2027-03-28T01:59:00.000Z')
    expect(madridToUtc('2027-03-28', '03:00').toISOString()).toBe('2027-03-28T01:00:00.000Z')
    expect(madridTimeKey(madridToUtc('2027-03-28', '02:30'))).toBe('03:30')
    expect(madridTimeKind('2027-03-28', '02:30')).toBe('inexistente')
    expect(madridTimeKind('2027-03-28', '01:59')).toBe('normal')
    expect(madridTimeKind('2027-03-28', '03:00')).toBe('normal')
  })

  it('hora repetida (25-10-2026, 02:00–02:59): se toma la primera (CEST)', () => {
    expect(madridToUtc('2026-10-25', '01:59').toISOString()).toBe('2026-10-24T23:59:00.000Z')
    expect(madridToUtc('2026-10-25', '02:00').toISOString()).toBe('2026-10-25T00:00:00.000Z')
    expect(madridToUtc('2026-10-25', '02:30').toISOString()).toBe('2026-10-25T00:30:00.000Z')
    expect(madridToUtc('2026-10-25', '02:59').toISOString()).toBe('2026-10-25T00:59:00.000Z')
    expect(madridToUtc('2026-10-25', '03:00').toISOString()).toBe('2026-10-25T02:00:00.000Z')
    expect(madridTimeKind('2026-10-25', '02:00')).toBe('repetida')
    expect(madridTimeKind('2026-10-25', '02:59')).toBe('repetida')
    expect(madridTimeKind('2026-10-25', '03:00')).toBe('normal')
    expect(madridTimeKind('2026-10-25', '01:59')).toBe('normal')
  })

  it('ida y vuelta exacta cada 15 min en los días de cambio de hora (salvo la hora inexistente)', () => {
    for (const day of ['2026-10-24', '2026-10-25', '2026-10-26', '2027-03-27', '2027-03-28', '2027-03-29']) {
      for (let m = 0; m < 24 * 60; m += 15) {
        const time = `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
        const d = madridToUtc(day, time)
        if (madridTimeKind(day, time) === 'inexistente') continue
        expect(`${madridDateKey(d)} ${madridTimeKey(d)}`).toBe(`${day} ${time}`)
      }
    }
  })

  it('madridToUtcOptions da las dos horas posibles solo cuando se repiten', () => {
    const iso = (date: string, time: string) => madridToUtcOptions(date, time).map((d) => d.toISOString())
    expect(iso('2026-10-25', '02:30')).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'])
    expect(iso('2026-10-25', '03:30')).toEqual(['2026-10-25T02:30:00.000Z'])
    expect(iso('2027-03-28', '02:30')).toEqual(['2027-03-28T01:30:00.000Z'])
    expect(iso('2026-09-16', '09:00')).toEqual(['2026-09-16T07:00:00.000Z'])
    expect(() => madridToUtcOptions('2026-02-30', '09:00')).toThrow()
  })

  it('madridToUtc rechaza formatos y fechas imposibles', () => {
    for (const [date, time] of [
      ['2026-02-29', '09:00'],
      ['2026-02-30', '09:00'],
      ['2026-13-01', '09:00'],
      ['2026-00-10', '09:00'],
      ['2026-04-31', '09:00'],
      ['26-01-01', '09:00'],
      ['2026-1-1', '09:00'],
      ['', '09:00'],
      ['2026-09-16', '24:00'],
      ['2026-09-16', '09:60'],
      ['2026-09-16', '9:00'],
      ['2026-09-16', '09:00:00'],
      ['2026-09-16', ''],
    ]) {
      expect(() => madridToUtc(date, time), `${date} ${time}`).toThrow(/no es válida/)
    }
  })
})

describe('semanas ISO', () => {
  it('weekStartKey devuelve el lunes', () => {
    expect(weekStartKey('2026-09-14')).toBe('2026-09-14')
    expect(weekStartKey('2026-09-16')).toBe('2026-09-14')
    expect(weekStartKey('2026-09-20')).toBe('2026-09-14')
    expect(weekStartKey('2026-09-21')).toBe('2026-09-21')
  })

  it('en el cambio de año (2026-12-28 a 2027-01-03) todo es la semana del 28/12/2026', () => {
    for (let i = 0; i < 7; i++) {
      const day = addDaysKey('2026-12-28', i)
      expect(weekStartKey(day), day).toBe('2026-12-28')
    }
    expect(addDaysKey('2026-12-28', 6)).toBe('2027-01-03')
    expect(isoWeekday('2027-01-03')).toBe(7)
    expect(weekStartKey('2026-12-27')).toBe('2026-12-21')
    expect(weekStartKey('2027-01-04')).toBe('2027-01-04')
  })

  it('semanas que cruzan un cambio de hora y un año bisiesto', () => {
    expect(weekStartKey('2026-10-25')).toBe('2026-10-19')
    expect(weekStartKey('2027-03-28')).toBe('2027-03-22')
    expect(weekStartKey('2028-03-01')).toBe('2028-02-28')
  })
})

describe('progress', () => {
  const now = ms('2026-09-16T10:00:00Z')
  const sessions = [
    mk({ start: '2026-09-14T07:00:00Z', end: '2026-09-14T09:00:00Z' }), // live 2 h
    mk({ start: '2026-09-14T12:00:00Z', end: '2026-09-14T13:30:00Z', method: 'manual' }), // manual 1 h 30
    mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z', adjusted: true, rev: 1 }), // ajustada 1 h
    mk({ start: '2026-09-15T09:00:00Z', end: '2026-09-15T14:00:00Z', voided: true, rev: 2 }), // anulada 5 h
    mk({ start: '2026-09-16T09:30:00Z' }), // abierta
  ]
  const open = sessions[4]

  it('suma solo cerradas no anuladas y muestra la abierta aparte', () => {
    const p = progress(sessions, 298, open, now)
    expect(p.doneMs).toBe(4.5 * HOUR_MS)
    expect(p.manualMs).toBe(1.5 * HOUR_MS)
    expect(p.liveMethodMs).toBe(3 * HOUR_MS)
    expect(p.adjustedCount).toBe(1)
    expect(p.validCount).toBe(3)
    expect(p.targetMs).toBe(298 * HOUR_MS)
    expect(p.remainingMs).toBe(293.5 * HOUR_MS)
    expect(p.pct).toBeCloseTo((4.5 / 298) * 100, 10)
    expect(p.liveMs).toBe(30 * MINUTE_MS)
  })

  it('aplica el desfase del reloj y nunca da tiempo en vivo negativo', () => {
    expect(progress(sessions, 298, open, now, 60_000).liveMs).toBe(31 * MINUTE_MS)
    expect(progress(sessions, 298, open, ms('2026-09-16T09:00:00Z')).liveMs).toBe(0)
    expect(progress(sessions, 298, null, now).liveMs).toBe(0)
    // Una "abierta" que ya está cerrada no suma en vivo
    expect(progress(sessions, 298, sessions[0], now).liveMs).toBe(0)
  })

  it('la sesión abierta cuenta como mucho 16 h y avisa de que las ha superado', () => {
    const long = mk({ start: '2026-09-15T17:00:00Z' }) // 17 h antes de `now`
    const p = progress(sessions, 298, long, now)
    expect(p.liveMs).toBe(16 * HOUR_MS)
    expect(p.liveOverMax).toBe(true)
    // 72 h abierta: igual, 16 h como mucho
    expect(progress(sessions, 298, mk({ start: '2026-09-13T10:00:00Z' }), now).liveMs).toBe(16 * HOUR_MS)
    // 16 h justas todavía se pueden parar con la hora actual
    const exact = progress(sessions, 298, mk({ start: '2026-09-15T18:00:00Z' }), now)
    expect(exact.liveMs).toBe(16 * HOUR_MS)
    expect(exact.liveOverMax).toBe(false)
    expect(progress(sessions, 298, open, now).liveOverMax).toBe(false)
    expect(progress(sessions, 298, null, now).liveOverMax).toBe(false)
  })

  it('topa en 100 % y 0 restante', () => {
    const p = progress(sessions, 4, open, now)
    expect(p.pct).toBe(100)
    expect(p.remainingMs).toBe(0)
    const q = progress(sessions, 0, null, now)
    expect(q.pct).toBe(100)
    expect(q.remainingMs).toBe(0)
    expect(progress([], 298, null, now).pct).toBe(0)
  })
})

describe('cifras de progreso a la vista', () => {
  const now = ms('2026-09-16T10:00:00Z')
  const from = ms('2026-09-01T00:00:00Z')
  const lasting = (durationMs: number) => mk({ start: new Date(from).toISOString(), end: new Date(from + durationMs).toISOString() })
  // 119 h 23 min 40 s hechos
  const done = [lasting(119 * HOUR_MS + 23 * MINUTE_MS + 40_000)]

  it('hecho (truncado) + restante (redondeado hacia arriba) = objetivo', () => {
    const p = progress(done, 298, null, now)
    expect(formatDuration(p.doneMs)).toBe('119 h 23 min')
    expect(formatDuration(p.remainingMs)).toBe('178 h 36 min')
    expect(formatDuration(displayRemainingMs(p))).toBe('178 h 37 min')
    expect(Math.floor(p.doneMs / MINUTE_MS) + displayRemainingMs(p) / MINUTE_MS).toBe(298 * 60)
  })

  it('con menos de un minuto restante no se ve 0 min ni 100,0 %', () => {
    const almost = [lasting(10 * HOUR_MS - 30_000)]
    const p = progress(almost, 10, null, now)
    expect(p.remainingMs).toBe(30_000)
    expect(formatDuration(displayRemainingMs(p))).toBe('0 h 01 min')
    expect(displayPct(p)).toBe(99.9)
    const reached = progress(almost, 9, null, now)
    expect(displayPct(reached)).toBe(100)
    expect(displayRemainingMs(reached)).toBe(0)
  })

  it('el porcentaje se trunca a una décima sin errores de coma flotante', () => {
    const p = progress(done, 298, null, now)
    expect(displayPct(p)).toBe(40)
    // 0,453 → 45,3 (en binario 45,29999…)
    expect(displayPct({ ...p, pct: 0.453 * 100, remainingMs: 1 })).toBe(45.3)
    expect(displayPct({ ...p, pct: 12.36, remainingMs: 1 })).toBe(12.3)
  })
})

describe('resolveTargetHours y formatTimeSeconds', () => {
  it('solo acepta números mayores que 0', () => {
    expect(resolveTargetHours(298)).toBe(298)
    expect(resolveTargetHours(150.5)).toBe(150.5)
    expect(resolveTargetHours('150')).toBe(298)
    expect(resolveTargetHours(0)).toBe(298)
    expect(resolveTargetHours(-5)).toBe(298)
    expect(resolveTargetHours(Number.NaN)).toBe(298)
    expect(resolveTargetHours(Number.POSITIVE_INFINITY)).toBe(298)
    expect(resolveTargetHours(undefined)).toBe(298)
    expect(resolveTargetHours(null)).toBe(298)
  })

  it('formatTimeSeconds usa la hora de Madrid', () => {
    expect(formatTimeSeconds(ms('2026-09-16T11:05:37Z'))).toBe('13:05:37')
    expect(formatTimeSeconds(ms('2026-01-16T23:00:05Z'))).toBe('00:00:05')
  })
})

describe('estimateFinish', () => {
  const now = ms('2026-09-16T10:00:00Z')

  it('null si no queda nada o no hay ritmo reciente', () => {
    const old = [mk({ start: '2026-08-01T07:00:00Z', end: '2026-08-01T15:00:00Z' })]
    expect(estimateFinish(old, 10 * HOUR_MS, now)).toBeNull()
    expect(estimateFinish([], 10 * HOUR_MS, now)).toBeNull()
    const recent = [mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T15:00:00Z' })]
    expect(estimateFinish(recent, 0, now)).toBeNull()
    // Anuladas y abiertas no dan ritmo
    const noPace = [
      mk({ start: '2026-09-15T07:00:00Z', end: '2026-09-15T15:00:00Z', voided: true }),
      mk({ start: '2026-09-16T07:00:00Z' }),
    ]
    expect(estimateFinish(noPace, 10 * HOUR_MS, now)).toBeNull()
  })

  it('ritmo = horas de las últimas 4 semanas / 4', () => {
    // 40 h en las últimas 4 semanas → 10 h/semana; faltan 100 h → 10 semanas
    const sessions = [0, 1, 2, 3, 4].map((i) =>
      mk({ start: new Date(now - (i + 1) * 5 * DAY_MS).toISOString(), end: new Date(now - (i + 1) * 5 * DAY_MS + 8 * HOUR_MS).toISOString() }),
    )
    const finish = estimateFinish(sessions, 100 * HOUR_MS, now)
    expect(finish?.getTime()).toBe(now + 10 * WEEK_MS)
  })

  it('primer mes: con program_start divide por las semanas reales transcurridas (mínimo 1)', () => {
    // Empezó el lunes 07/09 y lleva 36 h (6 h al día) hasta el miércoles 16/09
    const programStart = ms('2026-09-06T22:00:00Z') // 07/09 00:00 en Madrid
    const days = ['07', '08', '09', '10', '11', '14']
    const sessions = days.map((d) => mk({ start: `2026-09-${d}T07:00:00Z`, end: `2026-09-${d}T13:00:00Z` }))
    const remaining = 262 * HOUR_MS
    // Sin program_start: 36 h / 4 semanas = 9 h/semana → unas 29 semanas
    const old = estimateFinish(sessions, remaining, now)!
    expect((old.getTime() - now) / WEEK_MS).toBeCloseTo(262 / 9, 5)
    // Con program_start: 36 h en 9,5 días (1,36 semanas) ≈ 26,5 h/semana → unas 10 semanas
    const weeks = (now - programStart) / WEEK_MS
    const fixed = estimateFinish(sessions, remaining, now, programStart)!
    expect((fixed.getTime() - now) / WEEK_MS).toBeCloseTo(262 / (36 / weeks), 5)
    expect((fixed.getTime() - now) / WEEK_MS).toBeLessThan(11)
    // El primer día no se extrapola: mínimo 1 semana (3 h/semana → 30 h = 10 semanas)
    const firstDay = [mk({ start: '2026-09-16T06:00:00Z', end: '2026-09-16T09:00:00Z' })]
    const day1 = estimateFinish(firstDay, 30 * HOUR_MS, now, ms('2026-09-15T22:00:00Z'))!
    expect(day1.getTime()).toBe(now + 10 * WEEK_MS)
  })

  it('program_start antiguo o no válido: la ventana normal de 4 semanas', () => {
    const at = (offsetMs: number, durationMs: number) =>
      mk({ start: new Date(now - offsetMs).toISOString(), end: new Date(now - offsetMs + durationMs).toISOString() })
    const sessions = [at(3 * DAY_MS, 8 * HOUR_MS)]
    const base = estimateFinish(sessions, 10 * HOUR_MS, now)
    expect(base).not.toBeNull()
    expect(estimateFinish(sessions, 10 * HOUR_MS, now, now - 60 * DAY_MS)).toEqual(base)
    expect(estimateFinish(sessions, 10 * HOUR_MS, now, null)).toEqual(base)
    expect(estimateFinish(sessions, 10 * HOUR_MS, now, Number.NaN)).toEqual(base)
    // Las sesiones anteriores a program_start no dan ritmo
    expect(estimateFinish([at(3 * DAY_MS, HOUR_MS)], 10 * HOUR_MS, now, now - DAY_MS)).toBeNull()
    // Una sesión que empieza justo en program_start sí cuenta (7 h en 2 días → mínimo 1 semana → 7 h/semana)
    expect(estimateFinish([at(2 * DAY_MS, 7 * HOUR_MS)], 7 * HOUR_MS, now, now - 2 * DAY_MS)?.getTime()).toBe(now + WEEK_MS)
  })

  it('la ventana excluye justo el borde de hace 4 semanas', () => {
    const edge = now - 4 * WEEK_MS
    const atEdge = [mk({ start: new Date(edge).toISOString(), end: new Date(edge + 4 * HOUR_MS).toISOString() })]
    expect(estimateFinish(atEdge, 10 * HOUR_MS, now)).toBeNull()
    const inside = [mk({ start: new Date(edge + 1).toISOString(), end: new Date(edge + 1 + 4 * HOUR_MS).toISOString() })]
    // 4 h / 4 = 1 h/semana → 10 h = 10 semanas
    expect(estimateFinish(inside, 10 * HOUR_MS, now)?.getTime()).toBe(now + 10 * WEEK_MS)
  })
})

describe('computeFlags', () => {
  const now = ms('2026-09-16T19:00:00Z')

  it('detecta solapes entre sesiones válidas (tocarse no es solapar; anuladas fuera)', () => {
    const a = mk({ id: 'a', start: '2026-09-15T07:00:00Z', end: '2026-09-15T11:00:00Z' })
    const b = mk({ id: 'b', start: '2026-09-15T10:00:00Z', end: '2026-09-15T12:00:00Z' })
    const c = mk({ id: 'c', start: '2026-09-15T12:00:00Z', end: '2026-09-15T13:00:00Z' })
    const d = mk({ id: 'd', start: '2026-09-15T06:00:00Z', end: '2026-09-15T14:00:00Z', voided: true })
    const e = mk({ id: 'e', start: '2026-09-15T08:00:00Z', end: '2026-09-15T09:00:00Z', method: 'manual' })
    const f = computeFlags([c, d, b, a, e], now)
    expect(f.get('a')!.overlapsWith.sort()).toEqual(['b', 'e'])
    expect(f.get('b')!.overlapsWith).toEqual(['a'])
    expect(f.get('c')!.overlapsWith).toEqual([])
    expect(f.get('d')!.overlapsWith).toEqual([])
    expect(f.get('e')!.overlapsWith).toEqual(['a'])
  })

  it('las abiertas cuentan hasta ahora', () => {
    const open = mk({ id: 'open', start: '2026-09-16T15:00:00Z' })
    const manual = mk({ id: 'm', start: '2026-09-16T18:00:00Z', end: '2026-09-16T18:30:00Z', method: 'manual' })
    const later = mk({ id: 'later', start: '2026-09-16T19:00:00Z', end: '2026-09-16T19:30:00Z', method: 'manual' })
    const f = computeFlags([open, manual, later], now)
    expect(f.get('open')!.overlapsWith).toEqual(['m'])
    expect(f.get('later')!.overlapsWith).toEqual([])
    // Una abierta con ahora == inicio tiene duración 0 y no solapa
    const g = computeFlags([mk({ id: 'z', start: '2026-09-16T19:00:00Z' }), later], now)
    expect(g.get('z')!.overlapsWith).toEqual([])
  })

  it('una abierta de más de 16 h solo ocupa sus primeras 16 h', () => {
    // Abierta desde el 15 a las 12:00Z: cuenta como mucho hasta el 16 a las 04:00Z
    const forgotten = mk({ id: 'f', start: '2026-09-15T12:00:00Z' })
    expect(effectiveInterval(forgotten, now)).toEqual({ start: ms('2026-09-15T12:00:00Z'), end: ms('2026-09-16T04:00:00Z') })
    const after = mk({ id: 'after', start: '2026-09-16T08:00:00Z', end: '2026-09-16T10:00:00Z', method: 'manual' })
    const inside = mk({ id: 'inside', start: '2026-09-16T03:00:00Z', end: '2026-09-16T05:00:00Z', method: 'manual' })
    const f = computeFlags([forgotten, after, inside], now)
    expect(f.get('f')!.overlapsWith).toEqual(['inside'])
    expect(f.get('after')!.overlapsWith).toEqual([])
    // Las cerradas no se recortan
    const closed = mk({ id: 'c', start: '2026-09-10T00:00:00Z', end: '2026-09-11T00:00:00Z' })
    expect(effectiveInterval(closed, now).end).toBe(ms('2026-09-11T00:00:00Z'))
  })

  it('intervalos idénticos se solapan', () => {
    const x = mk({ id: 'x', start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z' })
    const y = mk({ id: 'y', start: '2026-09-15T07:00:00Z', end: '2026-09-15T08:00:00Z', method: 'manual' })
    const f = computeFlags([x, y], now)
    expect(f.get('x')!.overlapsWith).toEqual(['y'])
    expect(f.get('y')!.overlapsWith).toEqual(['x'])
  })

  it('día > 10 h por fecha de Madrid del inicio (10 h justas no marca)', () => {
    const exact = [
      mk({ id: 'e1', start: '2026-09-14T06:00:00Z', end: '2026-09-14T12:00:00Z' }),
      mk({ id: 'e2', start: '2026-09-14T13:00:00Z', end: '2026-09-14T17:00:00Z', method: 'manual' }),
    ]
    const f1 = computeFlags(exact, now)
    expect(f1.get('e1')!.dayOverLimit).toBe(false)
    expect(f1.get('e2')!.dayOverLimit).toBe(false)

    const over = [...exact, mk({ id: 'e3', start: '2026-09-14T18:00:00Z', end: '2026-09-14T18:01:00Z' })]
    const f2 = computeFlags(over, now)
    expect(['e1', 'e2', 'e3'].map((id) => f2.get(id)!.dayOverLimit)).toEqual([true, true, true])

    // Una anulada no suma ni se marca
    const withVoid = [...exact, mk({ id: 'v', start: '2026-09-14T18:00:00Z', end: '2026-09-14T20:00:00Z', voided: true })]
    const f3 = computeFlags(withVoid, now)
    expect(f3.get('e1')!.dayOverLimit).toBe(false)
    expect(f3.get('v')!.dayOverLimit).toBe(false)
  })

  it('una sesión que cruza la medianoche cuenta entera en el día en que empezó (Madrid)', () => {
    // 20:00–07:00 Madrid (11 h) empieza el 14
    const night = mk({ id: 'n', start: '2026-09-14T18:00:00Z', end: '2026-09-15T05:00:00Z' })
    const next = mk({ id: 'x', start: '2026-09-15T06:00:00Z', end: '2026-09-15T08:00:00Z' })
    const f = computeFlags([night, next], now)
    expect(f.get('n')!.dayOverLimit).toBe(true)
    expect(f.get('x')!.dayOverLimit).toBe(false)
  })

  it('usa el día de Madrid, no el UTC ni el del proceso', () => {
    // 23:30 del 14 y 00:30 del 15 en Madrid: mismo día UTC (14), días distintos en Madrid
    const late = mk({ id: 'late', start: '2026-09-14T21:30:00Z', end: '2026-09-14T21:59:00Z' })
    const early = mk({ id: 'early', start: '2026-09-14T22:30:00Z', end: '2026-09-15T08:29:00Z' }) // 9 h 59
    const f = computeFlags([late, early], now)
    expect(f.get('early')!.dayOverLimit).toBe(false)
    expect(f.get('late')!.dayOverLimit).toBe(false)
  })

  it('las abiertas suman hasta ahora en el total del día', () => {
    const open = mk({ id: 'o', start: '2026-09-16T08:00:00Z' }) // 11 h hasta las 19:00Z
    expect(computeFlags([open], now).get('o')!.dayOverLimit).toBe(true)
  })

  it('registrada tarde: solo si created_at - end_time supera 48 h', () => {
    const base = { start: '2026-09-01T08:00:00Z', end: '2026-09-01T10:00:00Z', method: 'manual' as const }
    const f = computeFlags(
      [
        mk({ ...base, id: 'justo', created: '2026-09-03T10:00:00Z' }),
        mk({ ...base, id: 'pasado', created: '2026-09-03T10:00:00.001Z' }),
        mk({ ...base, id: 'cinco', created: '2026-09-06T11:00:00Z' }),
        mk({ id: 'live', start: '2026-09-02T08:00:00Z', end: '2026-09-02T10:00:00Z', rev: 1 }),
        mk({ id: 'abierta', start: '2026-09-02T08:00:00Z' }),
      ],
      now,
    )
    expect(f.get('justo')!.lateDays).toBeNull()
    expect(f.get('pasado')!.lateDays).toBe(2)
    expect(f.get('cinco')!.lateDays).toBe(5)
    expect(f.get('live')!.lateDays).toBeNull()
    expect(f.get('abierta')!.lateDays).toBeNull()
  })

  it('editCount = rev - parada (live cerrada) - anulación', () => {
    const cases: [Opts, number][] = [
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', rev: 1 }, 0],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', rev: 3 }, 2],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', rev: 2, voided: true }, 0],
      [{ start: '2026-09-01T08:00:00Z', rev: 2 }, 2],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', method: 'manual', rev: 0 }, 0],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', method: 'manual', rev: 2 }, 2],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', method: 'manual', rev: 2, voided: true }, 1],
      [{ start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', rev: 0, voided: true }, 0],
    ]
    for (const [o, expected] of cases) {
      const s = mk(o)
      expect(editCountOf(s), JSON.stringify(o)).toBe(expected)
      expect(computeFlags([s], now).get(s.id)!.editCount).toBe(expected)
    }
  })

  it('escala sin coste cúbico', () => {
    const base = ms('2025-01-01T08:00:00Z')
    const many: Session[] = []
    for (let i = 0; i < 5000; i++) {
      const start = base + i * 6 * HOUR_MS
      many.push(mk({ id: `n${i}`, start: new Date(start).toISOString(), end: new Date(start + 5 * HOUR_MS).toISOString() }))
    }
    const t0 = performance.now()
    const f = computeFlags(many, now)
    expect(performance.now() - t0).toBeLessThan(2000)
    expect([...f.values()].every((x) => x.overlapsWith.length === 0)).toBe(true)

    const same = Array.from({ length: 300 }, (_, i) =>
      mk({ id: `o${i}`, start: '2026-09-01T08:00:00Z', end: '2026-09-01T09:00:00Z', method: 'manual' }),
    )
    const g = computeFlags(same, now)
    expect([...g.values()].every((x) => x.overlapsWith.length === 299)).toBe(true)
  })
})

describe('groupByWeek', () => {
  it('agrupa por semana ISO de Madrid en orden descendente y suma solo las válidas', () => {
    const sessions = [
      mk({ id: 'dom27', start: '2026-12-27T10:00:00Z', end: '2026-12-27T12:00:00Z' }),
      // lunes 28 a las 00:30 de Madrid (aún domingo 27 en UTC y en Nueva York)
      mk({ id: 'lun28', start: '2026-12-27T23:30:00Z', end: '2026-12-28T01:30:00Z' }),
      mk({ id: 'vie01', start: '2027-01-01T09:00:00Z', end: '2027-01-01T10:00:00Z', method: 'manual' }),
      mk({ id: 'anul', start: '2027-01-02T09:00:00Z', end: '2027-01-02T12:00:00Z', voided: true }),
      // domingo 3 a las 23:30 de Madrid (22:30Z): última hora de la semana del 28
      mk({ id: 'dom03', start: '2027-01-03T22:30:00Z', end: '2027-01-03T22:50:00Z' }),
      mk({ id: 'lun04', start: '2027-01-04T08:00:00Z' }),
    ]
    const weeks = groupByWeek(sessions)
    expect(weeks.map((w) => w.weekStart)).toEqual(['2027-01-04', '2026-12-28', '2026-12-21'])
    expect(weeks[0].sessions.map((s) => s.id)).toEqual(['lun04'])
    expect(weeks[0].validMs).toBe(0)
    expect(weeks[1].sessions.map((s) => s.id)).toEqual(['dom03', 'anul', 'vie01', 'lun28'])
    expect(weeks[1].validMs).toBe(2 * HOUR_MS + HOUR_MS + 20 * MINUTE_MS)
    expect(weeks[2].sessions.map((s) => s.id)).toEqual(['dom27'])
    expect(weeks[2].validMs).toBe(2 * HOUR_MS)
    expect(formatWeekLabel(weeks[1].weekStart)).toBe('Semana del 28/12/2026')
  })

  it('lista vacía', () => {
    expect(groupByWeek([])).toEqual([])
  })
})
