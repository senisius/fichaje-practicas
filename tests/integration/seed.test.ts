// Integración de operación: `npm run seed -- --open` + lectura con la app real (mismas consultas que
// AppDataProvider y mismos cálculos que la interfaz) + cambios sobre datos sembrados + backup.
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { deleteApp } from 'firebase/app'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setLogLevel,
  terminate,
  where,
  type QuerySnapshot,
} from 'firebase/firestore'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addComment,
  editSessionNote,
  signIn,
  signOutUser,
  stopSession,
  voidSession,
} from '../../src/data/api'
import { buildCsv, buildJson } from '../../src/data/export'
import { app, auth, db } from '../../src/data/firebase'
import { computeFlags, durationMs, isValidClosed, progress } from '../../src/lib/time'
import type { AppUser, BackupMeta, Comment, CommentDoc, LiveDoc, Session, SessionDoc, UserDoc } from '../../src/types'
import { ACCOUNTS, DAY, HOUR, MINUTE, type Account } from './helpers'

setLogLevel('error')

const run = promisify(execFile)
const ROOT = path.resolve(import.meta.dirname, '../..')
const BACKUP_DIR = path.join(ROOT, 'backups')
const STUDENT = ACCOUNTS.student.uid

async function loginAs(a: Account): Promise<void> {
  if (auth.currentUser) await signOutUser()
  await signIn(a.email, a.password)
}

const toSessions = (snap: QuerySnapshot): Session[] =>
  snap.docs.map((d) => ({ ...(d.data({ serverTimestamps: 'estimate' }) as SessionDoc), id: d.id }))
const toComments = (snap: QuerySnapshot): Comment[] =>
  snap.docs.map((d) => ({ ...(d.data() as CommentDoc), id: d.id }))

interface Loaded {
  sessions: Session[]
  comments: Comment[]
  users: AppUser[]
  live: string | null
  backup: BackupMeta | null
}

/** Lo que carga AppDataProvider para el student. */
async function loadAsStudent(): Promise<Loaded> {
  const [sessions, live, comments, users, backup] = await Promise.all([
    getDocs(query(collection(db, 'sessions'), where('owner', '==', STUDENT))),
    getDoc(doc(db, 'live', STUDENT)),
    getDocs(query(collection(db, 'comments'), where('session_owner', '==', STUDENT))),
    getDocs(collection(db, 'users')),
    getDoc(doc(db, 'meta', 'backup')),
  ])
  return {
    sessions: toSessions(sessions),
    comments: toComments(comments),
    users: users.docs.map((d) => ({ ...(d.data() as UserDoc), uid: d.id })),
    live: live.exists() ? (live.data() as LiveDoc).session_id : null,
    backup: backup.exists() ? (backup.data() as BackupMeta) : null,
  }
}

beforeAll(async () => {
  const { stdout } = await run(process.execPath, ['scripts/seed-emulator.mjs', '--open'], { cwd: ROOT })
  expect(stdout).toContain('Emuladores rellenados')
})

afterAll(async () => {
  if (auth.currentUser) await signOutUser()
  await terminate(db)
  await deleteApp(app)
})

describe('datos del seed leídos con la app', () => {
  let data: Loaded
  const now = Date.now()

  it('el student carga sus datos con las consultas del provider', async () => {
    await loginAs(ACCOUNTS.student)
    data = await loadAsStudent()
    expect(data.sessions).toHaveLength(27)
    expect(data.comments).toHaveLength(6)
    expect(data.users.map((u) => u.role).sort()).toEqual(['backup', 'student', 'supervisor'])
    const student = data.users.find((u) => u.role === 'student')!
    expect(student.target_hours).toBe(298)
    expect(Math.abs(student.program_start!.toMillis() - (now - 60 * DAY))).toBeLessThan(2 * DAY)
    // Todas las sesiones con las 12 claves y los comentarios apuntando a sesiones existentes
    const ids = new Set(data.sessions.map((s) => s.id))
    for (const s of data.sessions) expect(Object.keys(s).length).toBe(13)
    for (const c of data.comments) expect(ids.has(c.session_id)).toBe(true)
  })

  it('sesión en curso (--open) desde hace 2 h con su cerrojo', () => {
    const open = data.sessions.filter((s) => s.end_time == null)
    expect(open).toHaveLength(1)
    expect(data.live).toBe(open[0].id)
    expect(Math.abs(now - open[0].start_time.toMillis() - 2 * HOUR)).toBeLessThan(5 * MINUTE)
  })

  it('backup simulado de hace 3 días', () => {
    expect(data.backup).not.toBeNull()
    expect(Math.abs(now - data.backup!.last_backup_at.toMillis() - 3 * DAY)).toBeLessThan(5 * MINUTE)
    expect(Number.isInteger(data.backup!.docs)).toBe(true)
  })

  it('computeFlags encuentra los casos especiales del seed', () => {
    const flags = computeFlags(data.sessions, now)
    const withOverlap = data.sessions.filter((s) => flags.get(s.id)!.overlapsWith.length > 0)
    expect(withOverlap).toHaveLength(2)
    expect(flags.get(withOverlap[0].id)!.overlapsWith).toEqual([withOverlap[1].id])
    expect(withOverlap.map((s) => s.method).sort()).toEqual(['live', 'manual'])

    const longDay = data.sessions.filter((s) => flags.get(s.id)!.dayOverLimit)
    expect(longDay).toHaveLength(2)
    expect(longDay.reduce((n, s) => n + durationMs(s), 0)).toBeGreaterThan(10 * HOUR)

    const late = data.sessions.filter((s) => flags.get(s.id)!.lateDays !== null)
    expect(late.map((s) => flags.get(s.id)!.lateDays)).toEqual([5])
    expect(late[0].method).toBe('manual')

    const edited = data.sessions.filter((s) => flags.get(s.id)!.editCount > 0)
    expect(edited.map((s) => flags.get(s.id)!.editCount)).toEqual([1])

    expect(data.sessions.filter((s) => s.voided)).toHaveLength(1)
    expect(data.sessions.filter((s) => s.adjusted)).toHaveLength(2)
  })

  it('progreso y exportación coinciden', () => {
    const open = data.sessions.find((s) => s.end_time == null)!
    const p = progress(data.sessions, 298, open, now)
    const valid = data.sessions.filter(isValidClosed)
    expect(p.validCount).toBe(25)
    expect(p.doneMs).toBe(valid.reduce((n, s) => n + durationMs(s), 0))
    expect(p.manualMs + p.liveMethodMs).toBe(p.doneMs)
    expect(p.adjustedCount).toBe(2)
    expect(p.liveMs).toBeGreaterThan(2 * HOUR - 5 * MINUTE)
    expect(p.doneMs).toBeGreaterThan(100 * HOUR)

    const input = { sessions: data.sessions, comments: data.comments, users: data.users, nowMs: now }
    const csv = buildCsv(input).trimEnd().split('\r\n')
    expect(csv).toHaveLength(1 + 27 + 1)
    expect(csv.at(-1)).toContain(String(Math.floor(p.doneMs / MINUTE)))
    const json = JSON.parse(buildJson(input)) as { summary: { done_ms: number; valid_sessions: number } }
    expect(json.summary).toMatchObject({ done_ms: p.doneMs, valid_sessions: 25 })
  })

  it('la supervisora ve todo', async () => {
    await loginAs(ACCOUNTS.supervisor)
    const [sessions, live, comments] = await Promise.all([
      getDocs(collection(db, 'sessions')),
      getDocs(collection(db, 'live')),
      getDocs(collection(db, 'comments')),
    ])
    expect(sessions.size).toBe(27)
    expect(live.docs.map((d) => d.id)).toEqual([STUDENT])
    expect(comments.size).toBe(6)
    const edited = toSessions(sessions).find((s) => s.rev === 2)!
    expect((await getDocs(collection(db, 'sessions', edited.id, 'revisions'))).size).toBe(2)
  })
})

describe('cambios sobre los datos sembrados y backup', () => {
  it('las reglas aceptan los cambios de la app sobre documentos sembrados', async () => {
    await loginAs(ACCOUNTS.student)
    const { sessions } = await loadAsStudent()
    const edited = sessions.find((s) => s.rev === 2)!
    await editSessionNote(edited.id, `${edited.note} Añadido: conclusiones.`)
    const manual = sessions.find((s) => s.method === 'manual' && !s.voided && s.note.startsWith('Curso en línea'))!
    await voidSession(manual.id, 'Registrada en el día equivocado')
    await stopSession(STUDENT, 'Trabajo de hoy')

    const after = await loadAsStudent()
    expect(after.live).toBeNull()
    expect(after.sessions.find((s) => s.id === edited.id)!.rev).toBe(3)
    expect(after.sessions.find((s) => s.id === manual.id)!.voided).toBe(true)
    expect(after.sessions.filter((s) => s.end_time == null)).toHaveLength(0)

    await loginAs(ACCOUNTS.supervisor)
    const supervisor: AppUser = { uid: ACCOUNTS.supervisor.uid, role: 'supervisor', name: 'Profesora Demo' }
    await addComment(supervisor, after.sessions.find((s) => s.id === manual.id)!, 'Vale, gracias por anularla.')
    expect((await getDocs(collection(db, 'comments'))).size).toBe(7)
  })

  it('npm run backup -- --emulator guarda el JSON y actualiza meta/backup', async () => {
    const t0 = Date.now()
    const { stdout } = await run(process.execPath, ['scripts/backup.mjs', '--emulator'], { cwd: ROOT })
    const t1 = Date.now()
    const rel = /Copia guardada en (\S+\.json)/.exec(stdout)?.[1]
    expect(rel, stdout).toBeDefined()
    const file = path.resolve(ROOT, rel!)
    try {
      const backup = JSON.parse(await readFile(file, 'utf8')) as {
        format: string
        total_docs: number
        counts: Record<string, number>
        collections: { sessions: { id: string; data: Record<string, unknown>; revisions: unknown[] }[] }
      }
      expect(backup.format).toBe('fichaje-practicas-backup')
      expect(backup.counts).toEqual({ users: 3, sessions: 27, revisions: 25, live: 0, comments: 7, meta: 1 })
      const sample = backup.collections.sessions.find((s) => s.revisions.length === 3)!
      expect(sample.data.start_time).toMatchObject({ __type: 'timestamp' })

      await loginAs(ACCOUNTS.student)
      const meta = (await getDoc(doc(db, 'meta', 'backup'))).data() as BackupMeta
      expect(Object.keys(meta).sort()).toEqual(['docs', 'last_backup_at'])
      expect(meta.docs).toBe(backup.total_docs)
      expect(meta.last_backup_at.toMillis()).toBeGreaterThanOrEqual(t0 - 2000)
      expect(meta.last_backup_at.toMillis()).toBeLessThanOrEqual(t1 + 2000)
    } finally {
      await rm(file, { force: true })
      if ((await readdir(BACKUP_DIR).catch(() => ['?'])).length === 0) await rmdir(BACKUP_DIR)
    }
  })

  it('workflow: --no-mark no toca meta/backup y --mark-only lo marca al final; nombres con milisegundos', async () => {
    const tmp = await mkdtemp(path.join(tmpdir(), 'fichaje-gh-'))
    const created: string[] = []
    const filesBefore = new Set(await readdir(BACKUP_DIR).catch(() => [] as string[]))
    try {
      await loginAs(ACCOUNTS.student)
      const metaBefore = (await getDoc(doc(db, 'meta', 'backup'))).data() as BackupMeta

      // Dos volcados a la vez (como dos ejecuciones solapadas): aunque coincidan en el mismo
      // milisegundo, cada uno busca un nombre libre y ninguno sobrescribe al otro
      const outputs = [path.join(tmp, 'out1'), path.join(tmp, 'out2')]
      const results = await Promise.all(
        outputs.map((out) =>
          run(process.execPath, ['scripts/backup.mjs', '--emulator', '--no-mark'], {
            cwd: ROOT,
            env: { ...process.env, GITHUB_OUTPUT: out },
          }),
        ),
      )
      const vars = await Promise.all(
        outputs.map(async (out) =>
          Object.fromEntries((await readFile(out, 'utf8')).trim().split('\n').map((l) => l.split('=') as [string, string])),
        ),
      )
      for (const [i, v] of vars.entries()) {
        expect(results[i].stdout).toContain('meta/backup sin tocar (--no-mark)')
        expect(v.name).toMatch(/^fichaje-backup-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/)
        expect(v.file).toBe(`backups/${v.name}.json`)
        expect(Number(v.docs)).toBeGreaterThan(0)
        created.push(path.resolve(ROOT, v.file))
      }
      expect(vars[0].name).not.toBe(vars[1].name)
      const saved = JSON.parse(await readFile(created[0], 'utf8')) as { total_docs: number }
      expect(Number(vars[0].docs)).toBe(saved.total_docs)

      const filesAfterDump = (await readdir(BACKUP_DIR)).sort()

      // Nada ha cambiado en el indicador
      const metaAfterDump = (await getDoc(doc(db, 'meta', 'backup'))).data() as BackupMeta
      expect(metaAfterDump.last_backup_at.toMillis()).toBe(metaBefore.last_backup_at.toMillis())
      expect(metaAfterDump.docs).toBe(metaBefore.docs)

      // Argumentos incorrectos: salen con código 2 y no marcan nada
      const bad = async (args: string[], env: Record<string, string> = {}) => {
        const err = (await run(process.execPath, ['scripts/backup.mjs', '--emulator', ...args], {
          cwd: ROOT,
          env: { ...process.env, ...env },
        }).then(
          () => null,
          (e: unknown) => e,
        )) as { code?: number; stderr?: string } | null
        expect(err, args.join(' ')).not.toBeNull()
        expect(err!.code).toBe(2)
        return err!.stderr ?? ''
      }
      expect(await bad(['--mark-only'], { BACKUP_DOCS: 'muchos' })).toContain('BACKUP_DOCS')
      expect(await bad(['--mark-only'], { BACKUP_DOCS: '' })).toContain('BACKUP_DOCS')
      expect(await bad(['--mark-only'], { BACKUP_DOCS: '-3' })).toContain('BACKUP_DOCS')
      expect(await bad(['--no-mark', '--mark-only'])).toContain('a la vez')
      expect(await bad(['--otra'])).toContain('Argumento no reconocido')
      expect(((await getDoc(doc(db, 'meta', 'backup'))).data() as BackupMeta).docs).toBe(metaBefore.docs)

      // Paso final del workflow
      const t0 = Date.now()
      const { stdout } = await run(process.execPath, ['scripts/backup.mjs', '--emulator', '--mark-only'], {
        cwd: ROOT,
        env: { ...process.env, BACKUP_DOCS: vars[0].docs },
      })
      const t1 = Date.now()
      expect(stdout).toContain('meta/backup actualizado')
      const meta = (await getDoc(doc(db, 'meta', 'backup'))).data() as BackupMeta
      expect(meta.docs).toBe(Number(vars[0].docs))
      expect(meta.last_backup_at.toMillis()).toBeGreaterThanOrEqual(t0 - 2000)
      expect(meta.last_backup_at.toMillis()).toBeLessThanOrEqual(t1 + 2000)
      // --mark-only no genera ningún fichero
      expect((await readdir(BACKUP_DIR)).sort()).toEqual(filesAfterDump)
    } finally {
      // Se borra todo lo que haya creado este test, también si ha fallado a mitad
      const leftovers = (await readdir(BACKUP_DIR).catch(() => [] as string[])).filter((f) => !filesBefore.has(f))
      await Promise.all([...created, ...leftovers.map((f) => path.join(BACKUP_DIR, f))].map((f) => rm(f, { force: true })))
      if ((await readdir(BACKUP_DIR).catch(() => ['?'])).length === 0) await rmdir(BACKUP_DIR)
      await rm(tmp, { recursive: true, force: true })
    }
  })
})
