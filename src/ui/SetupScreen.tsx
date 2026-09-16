import { AppIcon, APP_NAME, Disclaimer } from './Brand'
import { IconSettings } from './icons'
import './screens.css'

// No importa nada de src/data: debe poder mostrarse aunque el SDK de Firebase no arranque.

export function SetupScreen({ detail }: { detail?: string }) {
  return (
    <main className="screen">
      <div className="screen-inner screen-inner-wide">
        <div className="screen-brand">
          <AppIcon size={56} />
          <p className="screen-title">{APP_NAME}</p>
        </div>
        <section className="card screen-card stack" aria-labelledby="setup-title">
          <div className="screen-icon screen-icon-warn">
            <IconSettings size={28} />
          </div>
          <h1 id="setup-title" className="screen-card-title">
            Falta la configuración de Firebase
          </h1>
          <p>La aplicación no encuentra los datos de conexión de tu proyecto de Firebase. Para configurarla:</p>
          <ol className="steps">
            <li>
              En la carpeta del proyecto, copia <code>.env.example</code> con el nombre <code>.env.local</code>.
            </li>
            <li>
              Rellena los valores con los de la consola de Firebase: <em>Configuración del proyecto › Tus apps › App web</em>
              . No son secretos: la seguridad la ponen las reglas de Firestore.
            </li>
            <li>
              Vuelve a arrancar <code>npm run dev</code> (o ejecuta <code>npm run build</code> antes de desplegar).
            </li>
          </ol>
          <p className="muted small">
            Para probarla en local sin un proyecto real: <code>npm run emulators</code>, después <code>npm run seed</code>{' '}
            y, en otra terminal, <code>npm run dev:emu</code>.
          </p>
          <p className="small">
            Guía completa:{' '}
            {import.meta.env.DEV ? (
              <a href="/docs/DESPLIEGUE.md" target="_blank" rel="noreferrer">
                docs/DESPLIEGUE.md
              </a>
            ) : (
              <code>docs/DESPLIEGUE.md</code>
            )}{' '}
            (en el repositorio).
          </p>
          {detail && (
            <details>
              <summary className="small">Detalle técnico</summary>
              <p className="error-detail">{detail}</p>
            </details>
          )}
        </section>
        <Disclaimer className="screen-disclaimer" />
      </div>
    </main>
  )
}
