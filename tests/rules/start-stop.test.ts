// START y STOP (normal y ajustado): positivos como el cliente y negativos campo a campo.
import { describe, expect, it } from 'vitest'
import { deleteField, serverTimestamp, Timestamp, type DocumentData } from 'firebase/firestore'
import {
  ago,
  clientTime,
  denied,
  HOUR,
  MINUTE,
  ok,
  OTHER,
  seedClosed,
  seedOpen,
  sessionData,
  setupEnv,
  start,
  stop,
  STUDENT,
  text,
  without,
  type Mut,
} from './helpers'

const t = setupEnv()
const REASON = 'Olvidé parar al salir'

describe('START (positivo, como el cliente)', () => {
  it('crea la sesión con las 12 claves y el cerrojo', async () => {
    const id = await ok(start(t.db(STUDENT), STUDENT))
    const s = await t.read(`sessions/${id}`)
    expect(s).toMatchObject({
      owner: STUDENT, method: 'live', end_time: null, adjusted: false, adjust_reason: '',
      voided: false, void_reason: '', note: '', rev: 0,
    })
    expect(Object.keys(s ?? {})).toHaveLength(12)
    expect(s?.start_time).toEqual(s?.created_at)
    expect(s?.updated_at).toEqual(s?.created_at)
    expect(await t.read(`live/${STUDENT}`)).toEqual({ session_id: id })
  })

  it('con nota inicial de 2000 caracteres', async () => {
    await ok(start(t.db(STUDENT), STUDENT, { session: (d) => ({ ...d, note: text(2000) }) }))
  })

  it('START después de un STOP', async () => {
    const db = t.db(STUDENT)
    await ok(start(db, STUDENT))
    await ok(stop(db, STUDENT))
    await ok(start(db, STUDENT))
  })

  it('cada student tiene su propio cerrojo', async () => {
    await ok(start(t.db(STUDENT), STUDENT))
    await ok(start(t.db(OTHER), OTHER))
  })
})

describe('START: negativos por campo', () => {
  const cases: [string, Mut][] = [
    ['clave extra', (d) => ({ ...d, status: 'en_curso' })],
    ['falta note', (d) => without(d, 'note')],
    ['falta updated_at', (d) => without(d, 'updated_at')],
    ['falta end_time', (d) => without(d, 'end_time')],
    ['owner ajeno', (d) => ({ ...d, owner: OTHER })],
    ['method manual sin fin', (d) => ({ ...d, method: 'manual' })],
    ['method desconocido', (d) => ({ ...d, method: 'otro' })],
    ['end_time no nulo', (d) => ({ ...d, end_time: serverTimestamp() })],
    ['rev 1', (d) => ({ ...d, rev: 1 })],
    ['rev como texto', (d) => ({ ...d, rev: '0' })],
    // El SDK envía -0 como double; == 0 lo daría por bueno y el cliente no podría cerrarla después
    ['rev -0 (double)', (d) => ({ ...d, rev: -0 })],
    ['adjusted true', (d) => ({ ...d, adjusted: true })],
    ['adjusted como texto', (d) => ({ ...d, adjusted: 'false' })],
    ['adjust_reason no vacío', (d) => ({ ...d, adjust_reason: REASON })],
    ['voided true', (d) => ({ ...d, voided: true })],
    ['void_reason no vacío', (d) => ({ ...d, void_reason: 'Registrada por error' })],
    ['note numérica', (d) => ({ ...d, note: 123 })],
    ['note de 2001 caracteres', (d) => ({ ...d, note: text(2001) })],
    ['start_time del cliente (pasado)', (d) => ({ ...d, start_time: ago(HOUR) })],
    ['start_time como texto', (d) => ({ ...d, start_time: new Date().toISOString() })],
    ['created_at del cliente', (d) => ({ ...d, created_at: clientTime() })],
    ['updated_at del cliente', (d) => ({ ...d, updated_at: clientTime() })],
  ]
  it.each(cases)('%s → denegado', async (_name, session) => {
    await denied(start(t.db(STUDENT), STUDENT, { session }))
  })
})

describe('START: cerrojo', () => {
  it('sin cerrojo → denegado', async () => {
    await denied(start(t.db(STUDENT), STUDENT, { live: null }))
  })

  it('cerrojo que apunta a otro id → denegado', async () => {
    await denied(start(t.db(STUDENT), STUDENT, { live: () => ({ session_id: 'otra-sesion' }) }))
  })

  it('cerrojo con clave extra → denegado', async () => {
    await denied(start(t.db(STUDENT), STUDENT, { live: (d) => ({ ...d, since: serverTimestamp() }) }))
  })

  it('reutilizar el id de una sesión existente → denegado', async () => {
    const id = 'ReusedSessionId12345'
    await seedClosed(t, id)
    await denied(start(t.db(STUDENT), STUDENT, { sessionId: id }))
  })

  it('segundo START con una sesión abierta → denegado y no cambia nada', async () => {
    await seedOpen(t)
    await denied(start(t.db(STUDENT), STUDENT, { skipClientCheck: true }))
    expect(await t.read(`live/${STUDENT}`)).toEqual({ session_id: 's-open' })
  })
})

describe('START: id de la sesión', () => {
  it('id fijo con el formato de los automáticos (20 letras y números) → permitido', async () => {
    const id = await ok(start(t.db(STUDENT), STUDENT, { sessionId: 'AbCdEfGhIjKlMnOpQr12' }))
    expect(id).toBe('AbCdEfGhIjKlMnOpQr12')
  })

  // Un id elegido a mano acabaría en la columna Id del CSV de la profesora
  const ids: [string, string][] = [
    ['fórmula =HYPERLINK', '=HYPERLINK("https:"&CHAR(47)&CHAR(47)&"evil.example";"Ver")'],
    ['fórmula @SUM', '@SUM(1+1)'],
    ['fórmula con + y 20 caracteres', '+SUM(1)abcdefghijklm'],
    ['id corto', 's-abierta'],
    ['id de 21 caracteres', 'AbCdEfGhIjKlMnOpQr123'],
    ['id de 20 con guion', 'AbCdEfGhIjKlMnOpQr-2'],
  ]
  it.each(ids)('%s → denegado', async (_name, sessionId) => {
    await denied(start(t.db(STUDENT), STUDENT, { sessionId }))
    expect(await t.read(`live/${STUDENT}`)).toBeUndefined()
  })
})

describe('STOP normal (positivo, como el cliente)', () => {
  it('cierra la sesión, guarda la revisión y borra el cerrojo', async () => {
    const before = await seedOpen(t)
    await ok(stop(t.db(STUDENT), STUDENT, 'Informe terminado'))
    const s = await t.read('sessions/s-open')
    expect(s).toMatchObject({ end_time: expect.any(Timestamp), adjusted: false, adjust_reason: '', note: 'Informe terminado', rev: 1 })
    expect(s?.updated_at).toEqual(s?.end_time)
    expect(await t.read(`live/${STUDENT}`)).toBeUndefined()
    const rev = await t.read('sessions/s-open/revisions/0')
    expect(rev?.before).toEqual(before)
    expect(rev?.at).toEqual(s?.end_time)
  })

  it('sin nota', async () => {
    await seedOpen(t)
    await ok(stop(t.db(STUDENT), STUDENT))
  })

  it('con nota de 2000 caracteres', async () => {
    await seedOpen(t)
    await ok(stop(t.db(STUDENT), STUDENT, text(2000)))
  })

  it('a las 15 h 55 min', async () => {
    await seedOpen(t, 's-open', { start_time: ago(15 * HOUR + 55 * MINUTE) })
    await ok(stop(t.db(STUDENT), STUDENT))
  })

  it('con la nota ya editada antes (rev > 0)', async () => {
    await seedOpen(t, 's-open', { note: 'Empiezo', rev: 3 })
    await ok(stop(t.db(STUDENT), STUDENT, 'Termino'))
    expect((await t.read('sessions/s-open/revisions/3'))?.before.rev).toBe(3)
  })
})

describe('STOP ajustado (positivo, como el cliente)', () => {
  it('con nota: guarda la hora tecleada y el motivo (caso más costoso)', async () => {
    await seedOpen(t, 's-open', { start_time: ago(20 * HOUR) })
    const at = new Date(Date.now() - 10 * HOUR)
    await ok(stop(t.db(STUDENT), STUDENT, 'Olvidé fichar la salida', { at, reason: REASON }))
    const s = await t.read('sessions/s-open')
    expect(s).toMatchObject({ adjusted: true, adjust_reason: REASON, note: 'Olvidé fichar la salida', rev: 1 })
    expect((s!.end_time as Timestamp).toMillis()).toBe(at.getTime())
    expect(await t.read(`live/${STUDENT}`)).toBeUndefined()
  })

  it('de exactamente 16 h', async () => {
    const startMs = Date.now() - 20 * HOUR
    await seedOpen(t, 's-open', { start_time: Timestamp.fromMillis(startMs) })
    await ok(stop(t.db(STUDENT), STUDENT, '', { at: new Date(startMs + 16 * HOUR), reason: REASON }))
  })

  it('un minuto después del inicio (terminé antes)', async () => {
    const startMs = Date.now() - 2 * HOUR
    await seedOpen(t, 's-open', { start_time: Timestamp.fromMillis(startMs) })
    await ok(stop(t.db(STUDENT), STUDENT, '', { at: new Date(startMs + MINUTE), reason: REASON }))
  })

  it('con motivo de 10 caracteres', async () => {
    await seedOpen(t)
    await ok(stop(t.db(STUDENT), STUDENT, '', { at: new Date(Date.now() - MINUTE), reason: text(10) }))
  })

  it('con motivo de 500 caracteres', async () => {
    await seedOpen(t)
    await ok(stop(t.db(STUDENT), STUDENT, '', { at: new Date(Date.now() - MINUTE), reason: text(500) }))
  })
})

describe('STOP normal: negativos', () => {
  it('con más de 16 h → denegado', async () => {
    await seedOpen(t, 's-open', { start_time: ago(16 * HOUR + 5 * MINUTE) })
    await denied(stop(t.db(STUDENT), STUDENT))
  })

  const cases: [string, Mut][] = [
    ['end_time del cliente', (u) => ({ ...u, end_time: clientTime() })],
    ['end_time nulo', (u) => ({ ...u, end_time: null })],
    ['adjusted true con hora del servidor', (u) => ({ ...u, adjusted: true, adjust_reason: REASON })],
    ['adjusted true sin motivo', (u) => ({ ...u, adjusted: true })],
    ['adjust_reason sin adjusted', (u) => ({ ...u, adjust_reason: REASON })],
    ['adjusted como texto', (u) => ({ ...u, adjusted: 'false' })],
    ['note de 2001 caracteres', (u) => ({ ...u, note: text(2001) })],
    ['note numérica', (u) => ({ ...u, note: 5 })],
    ['note borrada', (u) => ({ ...u, note: deleteField() })],
    ['adjust_reason borrado', (u) => ({ ...u, adjust_reason: deleteField() })],
    ['rev + 2', (u) => ({ ...u, rev: u.rev + 1 })],
    ['rev sin cambiar', (u) => ({ ...u, rev: u.rev - 1 })],
    ['rev como texto', (u) => ({ ...u, rev: String(u.rev) })],
    ['updated_at del cliente', (u) => ({ ...u, updated_at: clientTime() })],
    ['updated_at sin cambiar', (u) => without(u, 'updated_at')],
    ['cambia start_time', (u) => ({ ...u, start_time: ago(HOUR) })],
    ['cambia method', (u) => ({ ...u, method: 'manual' })],
    ['cambia owner', (u) => ({ ...u, owner: OTHER })],
    ['cambia created_at', (u) => ({ ...u, created_at: serverTimestamp() })],
    ['anula a la vez', (u) => ({ ...u, voided: true, void_reason: 'Registrada por error' })],
    ['clave extra', (u) => ({ ...u, status: 'cerrada' })],
  ]
  it.each(cases)('%s → denegado', async (_name, update) => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, 'Nota', undefined, { update }))
  })

  const revCases: [string, { revId?: (cur: DocumentData) => string; revision?: Mut }][] = [
    ['revisión con id siguiente', { revId: (cur) => String(cur.rev + 1) }],
    ['revisión con id no numérico', { revId: () => 'x' }],
    ['before sin una clave', { revision: (r) => ({ ...r, before: without(r.before, 'note') }) }],
    ['before con clave extra', { revision: (r) => ({ ...r, before: { ...r.before, status: 'en_curso' } }) }],
    ['before con end_time no nulo', { revision: (r) => ({ ...r, before: { ...r.before, end_time: ago(MINUTE) } }) }],
    ['before con otro rev', { revision: (r) => ({ ...r, before: { ...r.before, rev: 1 } }) }],
    ['before con created_at desplazado 1 ms', {
      revision: (r) => ({
        ...r,
        before: { ...r.before, created_at: Timestamp.fromMillis(r.before.created_at.toMillis() + 1) },
      }),
    }],
    ['before vacío', { revision: (r) => ({ ...r, before: {} }) }],
    ['before con los datos de otro student', { revision: (r) => ({ ...r, before: { ...r.before, owner: OTHER } }) }],
    ['before como mapa de otra forma', { revision: (r) => ({ ...r, before: sessionData({ note: 'otra' }) }) }],
    ['at del cliente', { revision: (r) => ({ ...r, at: clientTime() }) }],
    ['sin at', { revision: (r) => without(r, 'at') }],
    ['revisión con clave extra', { revision: (r) => ({ ...r, by: STUDENT }) }],
  ]
  it.each(revCases)('%s → denegado', async (_name, mut) => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, mut))
  })

  it('sin revisión → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, { skipRevision: true }))
  })

  it('sin borrar live → denegado', async () => {
    await seedOpen(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, { skipLiveDelete: true }))
  })

  it('sesión ya cerrada → denegado', async () => {
    await seedClosed(t)
    await denied(stop(t.db(STUDENT), STUDENT, '', undefined, { sessionId: 's-closed', skipLiveDelete: true }))
  })

  it('sesión abierta de otro student → denegado', async () => {
    const cur = await seedOpen(t, 's-otra', { owner: OTHER })
    await denied(stop(t.db(STUDENT), OTHER, '', undefined, { sessionId: 's-otra', cur }))
  })
})

describe('STOP ajustado: negativos', () => {
  const startMs = () => Date.now() - 20 * HOUR
  const cases: [string, (s: number) => { at: Date; reason: string }][] = [
    ['fin en el futuro', () => ({ at: new Date(Date.now() + 10 * MINUTE), reason: REASON })],
    ['fin igual al inicio', (s) => ({ at: new Date(s), reason: REASON })],
    ['fin antes del inicio', (s) => ({ at: new Date(s - MINUTE), reason: REASON })],
    ['más de 16 h', (s) => ({ at: new Date(s + 16 * HOUR + MINUTE), reason: REASON })],
    ['motivo de 9 caracteres', (s) => ({ at: new Date(s + HOUR), reason: text(9) })],
    ['motivo de 501 caracteres', (s) => ({ at: new Date(s + HOUR), reason: text(501) })],
    ['motivo solo con espacios', (s) => ({ at: new Date(s + HOUR), reason: text(12, ' ') })],
    ['motivo vacío', (s) => ({ at: new Date(s + HOUR), reason: '' })],
  ]
  it.each(cases)('%s → denegado', async (_name, fix) => {
    const s = startMs()
    await seedOpen(t, 's-open', { start_time: Timestamp.fromMillis(s) })
    await denied(stop(t.db(STUDENT), STUDENT, 'Nota', fix(s)))
  })

  const updCases: [string, Mut][] = [
    ['adjusted false con hora tecleada', (u) => ({ ...u, adjusted: false, adjust_reason: '' })],
    ['adjusted false con motivo', (u) => ({ ...u, adjusted: false })],
    ['adjusted como texto', (u) => ({ ...u, adjusted: 'true' })],
    ['motivo numérico', (u) => ({ ...u, adjust_reason: 1234567890 })],
    ['note de 2001 caracteres', (u) => ({ ...u, note: text(2001) })],
    ['cambia start_time', (u) => ({ ...u, start_time: ago(HOUR) })],
  ]
  it.each(updCases)('%s → denegado', async (_name, update) => {
    const s = startMs()
    await seedOpen(t, 's-open', { start_time: Timestamp.fromMillis(s) })
    await denied(stop(t.db(STUDENT), STUDENT, 'Nota', { at: new Date(s + HOUR), reason: REASON }, { update }))
  })
})
