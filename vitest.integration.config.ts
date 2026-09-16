import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// Tests de integración: los módulos reales de src/data contra los emuladores (Auth 9099,
// Firestore 8181) con las reglas reales. Se lanzan con `npm run test:integration`.
// Se cargan las variables de .env.emulator (VITE_USE_EMULATORS=true) en import.meta.env, así
// src/data/firebase.ts se conecta a los emuladores igual que con `npm run dev:emu`.
export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    environment: 'node',
    env: loadEnv('emulator', import.meta.dirname, 'VITE_'),
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
})
