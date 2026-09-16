// Registro del service worker (public/sw.js). src/main.tsx solo lo llama en producción.
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return

  const register = async () => {
    try {
      // updateViaCache: 'none' → al buscar actualizaciones ignora la caché HTTP.
      await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    } catch (error) {
      console.warn('No se pudo registrar el service worker:', error)
    }
  }

  // Tras 'load', para no competir con la carga inicial de la app.
  if (document.readyState === 'complete') void register()
  else window.addEventListener('load', () => void register(), { once: true })
}
