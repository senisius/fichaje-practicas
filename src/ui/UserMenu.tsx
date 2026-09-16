import { useEffect, useId, useRef, useState } from 'react'
import { friendlyError, signOutUser } from '../data/api'
import { useAppData } from '../data/AppDataProvider'
import { buildCsv, buildJson, downloadFile, exportFilename } from '../data/export'
import type { AppUser } from '../types'
import { ChangePasswordDialog } from './ChangePasswordDialog'
import { IconChevronDown, IconDownload, IconFile, IconKey, IconLogout } from './icons'
import { initials, roleLabel } from './text'
import { useToast } from './toast-context'

export function UserMenu({ user, online }: { user: AppUser; online: boolean }) {
  const data = useAppData()
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const menuId = useId()

  // Cerrar al pulsar fuera o con Escape (devolviendo el foco al botón).
  useEffect(() => {
    if (!open) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node
      if (popoverRef.current?.contains(target) || buttonRef.current?.contains(target)) return
      setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Al abrir, el foco va a la primera opción.
  useEffect(() => {
    if (open) popoverRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [open])

  const closeMenu = () => {
    buttonRef.current?.focus()
    setOpen(false)
  }

  const exportAs = (kind: 'csv' | 'json') => {
    closeMenu()
    try {
      const nowMs = Date.now()
      const input = { sessions: data.sessions, comments: data.comments, users: data.users, nowMs }
      const content = kind === 'csv' ? buildCsv(input) : buildJson(input)
      const mime = kind === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'
      downloadFile(exportFilename(kind, nowMs), content, mime)
      toast.show(kind === 'csv' ? 'CSV exportado. Guárdalo en tu carpeta de copias.' : 'JSON exportado.', 'success')
    } catch (e) {
      toast.show(friendlyError(e), 'error')
    }
  }

  const signOut = async () => {
    setSigningOut(true)
    try {
      await signOutUser()
    } catch (e) {
      setSigningOut(false)
      toast.show(friendlyError(e), 'error')
    }
  }

  const exportDisabled = data.loading || data.sessions.length === 0

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="menu-button"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar" aria-hidden="true">
          {initials(user.name)}
        </span>
        <IconChevronDown size={18} />
        <span className="visually-hidden">Menú de la cuenta</span>
      </button>

      {open && (
        <div
          ref={popoverRef}
          id={menuId}
          className="menu-popover"
          onBlur={(e) => {
            // Si el foco sale del menú con el teclado (Tab), se cierra.
            const next = e.relatedTarget
            if (next && !e.currentTarget.contains(next) && next !== buttonRef.current) setOpen(false)
          }}
        >
          <div className="menu-header">
            <p>
              <strong>{user.name}</strong>
            </p>
            <p className="muted small">{user.email ? `${roleLabel(user.role)} · ${user.email}` : roleLabel(user.role)}</p>
          </div>
          <ul className="menu-list">
            <li>
              <button
                type="button"
                className="menu-item"
                disabled={!online}
                onClick={() => {
                  closeMenu()
                  setPasswordOpen(true)
                }}
              >
                <IconKey />
                Cambiar contraseña
              </button>
            </li>
            <li>
              <button type="button" className="menu-item" disabled={exportDisabled} onClick={() => exportAs('csv')}>
                <IconDownload />
                Exportar CSV (Excel)
              </button>
            </li>
            <li>
              <button type="button" className="menu-item" disabled={exportDisabled} onClick={() => exportAs('json')}>
                <IconFile />
                Exportar JSON completo
              </button>
            </li>
            <li role="separator" className="menu-separator" />
            <li>
              <button type="button" className="menu-item" disabled={signingOut} onClick={signOut}>
                <IconLogout />
                {signingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}
              </button>
            </li>
          </ul>
        </div>
      )}

      {passwordOpen && <ChangePasswordDialog online={online} onClose={() => setPasswordOpen(false)} />}
    </>
  )
}
