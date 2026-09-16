import { useCallback, useEffect, useState } from 'react'
import { useAppData, useOnline } from '../data/AppDataProvider'
import { resolveTargetHours } from '../lib/time'
import type { AppUser } from '../types'
import { BackupIndicator } from './BackupIndicator'
import { ClockCard } from './ClockCard'
import { Footer } from './Footer'
import { Header } from './Header'
import { LiveIndicator } from './LiveIndicator'
import { ErrorNotice, Notice } from './Notice'
import { ProgressCard } from './ProgressCard'
import { SessionDetail } from './SessionDetail'
import { SessionList } from './SessionList'
import './layout.css'

/** Si los datos tardan más que esto en llegar, se avisa (p. ej. la red no llega a Firestore). */
const SLOW_LOAD_MS = 15_000

/** App con sesión iniciada (student o supervisora). Debe ir dentro de AppDataProvider. */
export function AppShell({ user }: { user: AppUser }) {
  const data = useAppData()
  const online = useOnline()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [slow, setSlow] = useState(false)
  const select = useCallback((id: string) => setSelectedId(id), [])

  useEffect(() => {
    if (!data.loading) return
    const t = window.setTimeout(() => setSlow(true), SLOW_LOAD_MS)
    return () => window.clearTimeout(t)
  }, [data.loading])

  const isStudent = user.role === 'student'
  const student = isStudent ? (data.student ?? user) : data.student
  // Igual que la exportación: un target_hours que no sea un número mayor que 0 se ignora
  const targetHours = resolveTargetHours(student?.target_hours)
  const badTarget = student !== null && student.target_hours !== undefined && student.target_hours !== targetHours
  const studentName = student?.name ?? 'El estudiante'
  const sessionsFailed = data.failed.includes('sessions')
  const liveFailed = data.failed.includes('live') || sessionsFailed

  return (
    <div className="app">
      <a className="skip-link" href="#contenido">
        Saltar al contenido
      </a>
      <Header user={user} online={online} />

      <main id="contenido" className="app-main" tabIndex={-1}>
        <h1 className="visually-hidden">
          {isStudent
            ? 'Tu registro de horas de prácticas'
            : student?.name
              ? `Registro de horas de ${student.name}`
              : 'Registro de horas del estudiante'}
        </h1>

        {data.error && (
          <div className="page-alerts">
            <ErrorNotice
              title="Problema al cargar los datos"
              message={data.error}
              onRetry={() => window.location.reload()}
            />
          </div>
        )}

        {data.loading && (!online || (slow && !data.error)) && (
          <div className="page-alerts">
            {!online ? (
              <Notice kind="warn" title="Sin conexión">
                <p>Los datos todavía no se han cargado. Aparecerán en cuanto vuelva la conexión.</p>
              </Notice>
            ) : (
              <ErrorNotice
                title="Los datos están tardando en llegar"
                message="Comprueba tu conexión. Si sigue así, recarga la página."
                onRetry={() => window.location.reload()}
              />
            )}
          </div>
        )}

        {isStudent && badTarget && (
          <div className="page-alerts">
            <Notice kind="warn" title="Revisa el objetivo de horas de tu perfil">
              <p>
                El campo <code>target_hours</code> de tu perfil no es un número mayor que 0, así que se usan{' '}
                {targetHours} h. Corrígelo en la consola de Firebase (tipo <strong>number</strong>; paso 6 de la guía de
                despliegue).
              </p>
            </Notice>
          </div>
        )}

        {!isStudent && !data.loading && !data.student && (
          <div className="page-alerts">
            <Notice kind="info" title="No hay ningún estudiante dado de alta">
              <p>Cuando exista su perfil, aquí verás su progreso y su historial.</p>
            </Notice>
          </div>
        )}

        <div className="layout">
          <div className="layout-side">
            {isStudent ? (
              <ClockCard
                user={user}
                openSession={data.openSession}
                serverSkewMs={data.serverSkewMs}
                online={online}
                loading={data.loading}
                unavailable={liveFailed}
              />
            ) : (
              (data.loading || data.student) && (
                <LiveIndicator
                  studentName={studentName}
                  openSession={data.openSession}
                  serverSkewMs={data.serverSkewMs}
                  loading={data.loading}
                  onOpen={select}
                />
              )
            )}
            <ProgressCard
              title={isStudent ? 'Tu progreso' : 'Progreso'}
              sessions={data.sessions}
              targetHours={targetHours}
              openSession={data.openSession}
              serverSkewMs={data.serverSkewMs}
              loading={data.loading}
              programStartMs={student?.program_start?.toMillis?.() ?? null}
              failed={sessionsFailed}
            />
            <BackupIndicator backup={data.backup} loading={data.loading} role={user.role} />
          </div>

          <div className="layout-main">
            <SessionList
              sessions={data.sessions}
              commentsBySession={data.commentsBySession}
              serverSkewMs={data.serverSkewMs}
              loading={data.loading}
              failed={sessionsFailed}
              emptyHint={
                isStudent
                  ? 'Pulsa EMPEZAR cuando comiences a trabajar o añade horas a mano.'
                  : 'Cuando el estudiante registre horas, aparecerán aquí.'
              }
              onSelect={select}
            />
          </div>
        </div>
      </main>

      <Footer />

      {selectedId && (
        <SessionDetail
          sessionId={selectedId}
          user={user}
          online={online}
          onClose={() => setSelectedId(null)}
          onSelect={select}
        />
      )}
    </div>
  )
}
