import { IconWifiOff } from './icons'

/** La región existe siempre para que el cambio se anuncie; el contenido solo aparece sin conexión. */
export function OfflineBanner({ online }: { online: boolean }) {
  return (
    <div role="status" aria-live="polite">
      {!online && (
        <div className="offline-banner">
          <IconWifiOff size={18} />
          <span>Sin conexión. Puedes consultar los datos, pero no fichar ni guardar cambios hasta que vuelva.</span>
        </div>
      )}
    </div>
  )
}
