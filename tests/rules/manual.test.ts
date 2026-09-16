// Entradas manuales (setDoc como el cliente) y sus límites.
import { describe, expect, it } from 'vitest'
import {
  collection,
  deleteField,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore'
import {
  addManual,
  clientTime,
  DAY,
  denied,
  HOUR,
  manualInput,
  MINUTE,
  newManualSession,
  ok,
  OTHER,
  seedManual,
  setupEnv,
  STUDENT,
  SUPERVISOR,
  text,
  without,
  type Mut,
} from './helpers'

const t = setupEnv()

interface Interval {
  startMs: number
  endMs: number
}
const span = (startMs: number, durationMs: number): Interval => ({ startMs, endMs: startMs + durationMs })

/** program_start de uid-otra (hace 10 días), leído del seed. */
async function otherProgramStart(): Promise<number> {
  const u = await t.read(`users/${OTHER}`)
  return (u!.program_start as Timestamp).toMillis()
}

describe('Manual (positivo, como el cliente)', () => {
  it('3 h hace 2 días: guarda las horas tecleadas y la hora del servidor en created_at', async () => {
    const input = manualInput()
    await ok(addManual(t.db(STUDENT), STUDENT, input))
    const snap = await getDocs(collection(t.db(SUPERVISOR), 'sessions'))
    expect(snap.size).toBe(1)
    const s = snap.docs[0].data()
    expect(s.start_time.toMillis()).toBe(input.startMs)
    expect(s.end_time.toMillis()).toBe(input.endMs)
    expect(s.created_at.toMillis()).toBeGreaterThan(input.endMs)
    expect(Object.keys(s)).toHaveLength(12)
  })

  // Un solo `now` por caso: dos Date.now() pueden diferir en 1 ms y romper los casos límite.
  const cases: [string, (now: number) => Interval][] = [
    ['exactamente 16 h', (now) => span(now - 3 * DAY, 16 * HOUR)],
    ['1 minuto', (now) => span(now - DAY, MINUTE)],
    ['terminada hace 1 minuto', (now) => ({ startMs: now - 2 * HOUR, endMs: now - MINUTE })],
    ['hace 30 días', (now) => span(now - 30 * DAY, HOUR)],
    ['hace 31 días menos 10 minutos', (now) => span(now - 31 * DAY + 10 * MINUTE, HOUR)],
    ['que cruza la medianoche', (now) => {
      const d = new Date(now - 3 * DAY)
      d.setUTCHours(21, 0, 0, 0)
      return span(d.getTime(), 5 * HOUR)
    }],
  ]
  it.each(cases)('%s', async (_name, input) => {
    await ok(addManual(t.db(STUDENT), STUDENT, manualInput(input(Date.now()))))
  })

  it('nota de 5 y de 2000 caracteres', async () => {
    await ok(addManual(t.db(STUDENT), STUDENT, manualInput({ note: 'abcde' })))
    await ok(addManual(t.db(STUDENT), STUDENT, manualInput({ note: text(2000) })))
  })

  it('empezando justo en program_start', async () => {
    const startMs = await otherProgramStart()
    await ok(addManual(t.db(OTHER), OTHER, manualInput({ startMs, endMs: startMs + HOUR })))
  })

  it('fin = hora del servidor', async () => {
    await ok(addManual(t.db(STUDENT), STUDENT, manualInput({ startMs: Date.now() - HOUR }), (d) => ({
      ...d,
      end_time: serverTimestamp(),
    })))
  })

  it('puede solapar con otra sesión (solo se avisa en el cliente)', async () => {
    const input = manualInput()
    await ok(addManual(t.db(STUDENT), STUDENT, input))
    await ok(addManual(t.db(STUDENT), STUDENT, input))
  })
})

describe('Manual: límites de tiempo', () => {
  const cases: [string, (now: number) => Interval][] = [
    ['fin en el futuro', (now) => ({ startMs: now - HOUR, endMs: now + 5 * MINUTE })],
    ['inicio y fin en el futuro', (now) => span(now + HOUR, HOUR)],
    ['16 h y 1 minuto', (now) => span(now - 3 * DAY, 16 * HOUR + MINUTE)],
    ['fin igual al inicio', (now) => span(now - DAY, 0)],
    ['fin antes del inicio', (now) => span(now - DAY, -HOUR)],
    ['hace 31 días y 10 minutos', (now) => span(now - 31 * DAY - 10 * MINUTE, 2 * HOUR)],
    ['hace 32 días', (now) => span(now - 32 * DAY, HOUR)],
    ['antes de program_start y de hace 31 días', (now) => span(now - 90 * DAY, HOUR)],
  ]
  it.each(cases)('%s → denegado', async (_name, input) => {
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput(input(Date.now()))))
  })

  it('un minuto antes de program_start → denegado', async () => {
    const ps = await otherProgramStart()
    await denied(addManual(t.db(OTHER), OTHER, manualInput({ startMs: ps - MINUTE, endMs: ps + HOUR })))
  })

  it('student sin program_start → denegado', async () => {
    await t.seed(`users/${OTHER}`, { role: 'student', name: 'Otra', target_hours: 298 })
    await denied(addManual(t.db(OTHER), OTHER, manualInput()))
  })
})

describe('Manual: negativos por campo', () => {
  const cases: [string, Mut][] = [
    ['nota de 4 caracteres', (d) => ({ ...d, note: 'abcd' })],
    ['nota solo con espacios', (d) => ({ ...d, note: text(10, ' ') })],
    ['nota vacía', (d) => ({ ...d, note: '' })],
    ['nota de 2001 caracteres', (d) => ({ ...d, note: text(2001) })],
    ['nota numérica', (d) => ({ ...d, note: 12345 })],
    ['start_time como texto', (d) => ({ ...d, start_time: d.start_time.toDate().toISOString() })],
    ['start_time como número', (d) => ({ ...d, start_time: d.start_time.toMillis() })],
    ['end_time como número', (d) => ({ ...d, end_time: d.end_time.toMillis() })],
    ['end_time nulo', (d) => ({ ...d, end_time: null })],
    ['created_at del cliente', (d) => ({ ...d, created_at: clientTime() })],
    ['updated_at del cliente', (d) => ({ ...d, updated_at: clientTime() })],
    ['owner ajeno', (d) => ({ ...d, owner: OTHER })],
    ['clave extra', (d) => ({ ...d, approx: true })],
    ['falta note', (d) => without(d, 'note')],
    ['falta adjusted', (d) => without(d, 'adjusted')],
    ['falta created_at', (d) => without(d, 'created_at')],
    ['rev 1', (d) => ({ ...d, rev: 1 })],
    ['rev -0 (double)', (d) => ({ ...d, rev: -0 })],
    ['rev 0,5', (d) => ({ ...d, rev: 0.5 })],
    ['adjusted true', (d) => ({ ...d, adjusted: true, adjust_reason: 'Hora aproximada' })],
    ['adjust_reason no vacío', (d) => ({ ...d, adjust_reason: 'Hora aproximada' })],
    ['voided true', (d) => ({ ...d, voided: true, void_reason: 'Registrada por error' })],
    ['void_reason no vacío', (d) => ({ ...d, void_reason: 'Registrada por error' })],
    ['method live con horas del cliente', (d) => ({ ...d, method: 'live' })],
    ['method desconocido', (d) => ({ ...d, method: 'otro' })],
  ]
  it.each(cases)('%s → denegado', async (_name, mut) => {
    await denied(addManual(t.db(STUDENT), STUDENT, manualInput(), mut))
  })

  it('uid-otra creando una manual a nombre del student → denegado', async () => {
    await denied(addManual(t.db(OTHER), STUDENT, manualInput()))
  })

  it('crear con id fijo sobre una sesión existente → denegado', async () => {
    const id = 'ExistingManual000001'
    await seedManual(t, id)
    await denied(setDoc(doc(t.db(STUDENT), 'sessions', id), newManualSession(STUDENT, manualInput({ note: 'Otra nota' }))))
  })

  it('id fijo con el formato de los automáticos → permitido; con otro formato → denegado', async () => {
    const db = t.db(STUDENT)
    await ok(setDoc(doc(db, 'sessions', 'ManualFixedId0000001'), newManualSession(STUDENT, manualInput())))
    for (const id of ['@SUM(1+1)', '=1+1', '-2+3abcdefghijklmnop', 'manual-con-guiones', 'Ñandú00000000000000x']) {
      await denied(setDoc(doc(db, 'sessions', id), newManualSession(STUDENT, manualInput())))
    }
  })

  it('updateDoc que borra claves de una manual → denegado', async () => {
    await seedManual(t, 's-x')
    await denied(updateDoc(doc(t.db(STUDENT), 'sessions', 's-x'), { note: deleteField() }))
  })
})
