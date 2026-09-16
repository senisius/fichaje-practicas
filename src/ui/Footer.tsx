import { Disclaimer } from './Brand'

export function Footer() {
  return (
    <footer className="app-footer">
      <div className="app-footer-inner">
        <Disclaimer />
        <p>Todas las fechas y horas se muestran en hora peninsular española (Europe/Madrid).</p>
      </div>
    </footer>
  )
}
