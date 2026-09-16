import { useState } from 'react'
import { DISCLAIMER_LEAD, DISCLAIMER_WARNING } from './text'

export const APP_NAME = 'Fichaje Prácticas'

/** Icono de la app (public/icons/app-icon.svg). Decorativo: el nombre va al lado en texto. */
export function AppIcon({ size = 32, className }: { size?: number; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <img
      src="/icons/app-icon.svg"
      alt=""
      width={size}
      height={size}
      className={className ? `app-icon ${className}` : 'app-icon'}
      onError={() => setFailed(true)}
    />
  )
}

/**
 * Logo oficial de la UAB tal cual (public/brand/uab-logo.svg). Sin filtros ni recoloreado:
 * altura fija y anchura automática, sobre fondo claro también en modo oscuro.
 * Si el fichero no existe, no se muestra nada.
 */
export function UabLogo({ className }: { className?: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <span className={className ? `uab-logo ${className}` : 'uab-logo'}>
      <img src="/brand/uab-logo.svg" alt="Universitat Autònoma de Barcelona" onError={() => setFailed(true)} />
    </span>
  )
}

/** "Herramienta personal, no oficial de la UAB. No uses aquí tu contraseña de la UAB." */
export function Disclaimer({ className }: { className?: string }) {
  return (
    <p className={className}>
      <strong>{DISCLAIMER_LEAD}</strong> {DISCLAIMER_WARNING}
    </p>
  )
}
