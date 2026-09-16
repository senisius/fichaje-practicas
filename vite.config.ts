import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rolldownOptions: {
      output: {
        // El SDK de Firebase va aparte de la app (Firestore en su propio chunk, que es el más grande):
        // cambia poco, así el navegador lo conserva en caché entre despliegues.
        codeSplitting: {
          groups: [
            { name: 'firestore', test: /[/\\]node_modules[/\\]@firebase[/\\]firestore[/\\]/ },
            { name: 'firebase', test: /[/\\]node_modules[/\\](@firebase|firebase)[/\\]/ },
          ],
        },
      },
    },
  },
})
