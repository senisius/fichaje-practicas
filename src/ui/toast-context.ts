import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'error' | 'info'

export interface ToastApi {
  show: (message: string, kind?: ToastKind) => void
}

export const ToastContext = createContext<ToastApi>({ show: () => {} })

/** Avisos breves y no bloqueantes (se anuncian por aria-live). */
export function useToast(): ToastApi {
  return useContext(ToastContext)
}
