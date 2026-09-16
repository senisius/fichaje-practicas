// Render en servidor (sin DOM) de componentes con textos que dependen del estado.
import { Timestamp } from 'firebase/firestore'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../types'
import { AuthScreen } from '../App'
import { LiveIndicator } from './LiveIndicator'
import { LoadingScreen } from './LoadingScreen'
import { ProgressCard } from './ProgressCard'
import { SessionRow } from './SessionRow'

vi.mock('../data/firebase', () => ({ firebaseConfigured: true, auth: {}, db: {} }))

const NOW = Date.parse('2026-09-16T10:00:00Z') // 12:00 en Madrid
const ts = (ms: number) => Timestamp.fromMillis(ms)
const HOUR = 3_600_000

function mk(id: string, startMs: number, endMs: number | null, extra: Partial<Session> = {}): Session {
  return {
    id,
    owner: 'stu',
    method: 'live',
    start_time: ts(startMs),
    end_time: endMs === null ? null : ts(endMs),
    adjusted: false,
    adjust_reason: '',
    voided: false,
    void_reason: '',
    note: '',
    rev: 0,
    created_at: ts(startMs),
    updated_at: ts(startMs),
    ...extra,
  }
}

/** Texto visible aproximado (sin etiquetas). */
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')

beforeEach(() => {
  vi.useFakeTimers({ now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('ProgressCard', () => {
  const closed = [mk('a', NOW - 50 * HOUR, NOW - 42 * HOUR + 40_000)] // 8 h 00 min 40 s

  const render = (open: Session | null, extra: Partial<Parameters<typeof ProgressCard>[0]> = {}) =>
    renderToStaticMarkup(
      <ProgressCard
        title="Progreso"
        sessions={open ? [...closed, open] : closed}
        targetHours={298}
        openSession={open}
        serverSkewMs={0}
        loading={false}
        {...extra}
      />,
    )

  it('con una sesión abierta normal: "+ … en curso (cuenta al parar)" y franja rayada', () => {
    const html = render(mk('o', NOW - 2 * HOUR, null))
    expect(text(html)).toContain('+ 2 h 00 min en curso')
    expect(text(html)).toContain('(cuenta al parar)')
    expect(html).toContain('progress-live')
  })

  it('con una sesión abierta hace más de 16 h: no promete que vaya a contar y no pinta la franja', () => {
    const html = render(mk('o', NOW - 17 * HOUR, null))
    expect(text(html)).toContain('+ más de 16 h en curso')
    expect(text(html)).toContain('(no cuentan hasta indicar la hora de fin)')
    expect(text(html)).not.toContain('17 h 00 min')
    expect(text(html)).not.toContain('cuenta al parar')
    expect(html).not.toContain('progress-live')
  })

  it('hecho + restante cuadran con el objetivo a la vista', () => {
    const t = text(render(null))
    expect(t).toContain('8 h 00 min')
    expect(t).toContain('Restante 290 h 00 min')
    expect(t).toContain('2,6 %')
  })

  it('si no se han podido cargar las sesiones, no muestra cifras', () => {
    const t = text(render(null, { failed: true }))
    expect(t).toContain('No se han podido cargar las horas')
    expect(t).not.toContain('de 298 h')
  })

  it('usa el inicio de las prácticas para el fin estimado del primer mes', () => {
    // 8 h en los 3 días desde el inicio: mínimo 1 semana → 8 h/semana; sin program_start, 2 h/semana
    const programStartMs = NOW - 3 * 24 * HOUR
    const withStart = text(render(null, { programStartMs }))
    const without = text(render(null))
    expect(withStart).not.toEqual(without)
    // 290 h a 8 h/semana ≈ 36 semanas (mayo de 2027); a 2 h/semana serían 145 semanas (2029)
    expect(withStart).toContain('2027')
    expect(without).toContain('2029')
  })
})

describe('LiveIndicator', () => {
  const render = (open: Session | null) =>
    renderToStaticMarkup(
      <LiveIndicator studentName="Marc" openSession={open} serverSkewMs={0} loading={false} onOpen={() => {}} />,
    )

  it('el texto para lector de pantalla es correcto si la sesión empezó otro día', () => {
    // Empezó el lunes 14/09 a las 09:00 de Madrid
    const html = render(mk('o', Date.parse('2026-09-14T07:00:00Z'), null))
    expect(html).toContain('Marc tiene una sesión en curso desde el lun 14/09/2026 a las 09:00.')
    expect(html).not.toContain('desde las lun')
  })

  it('mismo día: "desde las HH:MM"', () => {
    expect(render(mk('o', NOW - HOUR, null))).toContain('Marc tiene una sesión en curso desde las 11:00.')
  })

  it('entre 10 y 16 h avisa de un posible olvido; pasadas 16 h, de que hay que indicar la hora real', () => {
    const t11 = text(render(mk('o', NOW - 11 * HOUR, null)))
    expect(t11).toContain('puede que haya olvidado parar')
    const t17 = text(render(mk('o', NOW - 17 * HOUR, null)))
    expect(t17).toContain('Han pasado más de 16 h')
    expect(t17).toContain('tendrá que indicar la hora real de fin')
    expect(t17).not.toContain('puede que haya olvidado parar')
  })
})

describe('SessionRow', () => {
  const render = (s: Session, skewMs = 0) =>
    renderToStaticMarkup(
      <SessionRow session={s} flags={undefined} commentCount={0} skewMs={skewMs} sessionsById={new Map()} onSelect={() => {}} />,
    )

  it('nombre accesible corto: la nota va aparte, recortada, y la visible se oculta al lector', () => {
    const note = `Informe ${'muy largo '.repeat(100)}`
    const html = render(mk('s1', NOW - 5 * HOUR, NOW - HOUR, { note }))
    const button = /<button[^>]*>/.exec(html)![0]
    const labelledby = /aria-labelledby="([^"]+)"/.exec(button)![1].split(' ')
    const describedby = /aria-describedby="([^"]+)"/.exec(button)![1]
    expect(labelledby).toHaveLength(3)
    for (const id of labelledby) expect(html).toContain(`id="${id}"`)
    const described = new RegExp(`id="${describedby.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)<`).exec(html)![1]
    expect(described.startsWith('Nota: Informe muy largo')).toBe(true)
    expect(described.length).toBeLessThan(100)
    expect(described.endsWith('…')).toBe(true)
    expect(html).toMatch(/class="session-note" aria-hidden="true"/)
  })

  it('sin nota no hay descripción', () => {
    expect(render(mk('s2', NOW - 5 * HOUR, NOW - HOUR))).not.toContain('aria-describedby')
  })

  it('la duración de la sesión en curso usa el mismo reloj que el cronómetro (con desfase)', () => {
    const html = render(mk('o', NOW - 2 * HOUR + 30_000, null), 60_000)
    // 1 h 59 min 30 s + 60 s de desfase = 2 h 00 min 30 s
    expect(text(html)).toContain('2 h 00 min')
  })
})

describe('pantalla de carga', () => {
  it('sin avisos por defecto', () => {
    const html = renderToStaticMarkup(<LoadingScreen label="Comprobando la sesión…" />)
    expect(html).toContain('Comprobando la sesión…')
    expect(html).not.toContain('Reintentar')
  })

  it('si el perfil no se puede leer, lo explica y ofrece reintentar', () => {
    const html = renderToStaticMarkup(<AuthScreen auth={{ status: 'loading', unreachable: true }} />)
    expect(text(html)).toContain('No se puede conectar con el servidor')
    expect(html).toContain('Reintentar')
    expect(html).toContain('role="alert"')
    const normal = renderToStaticMarkup(<AuthScreen auth={{ status: 'loading' }} />)
    expect(normal).not.toContain('No se puede conectar')
  })
})
