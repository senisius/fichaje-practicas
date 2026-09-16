import { defineConfig } from 'vitest/config'

// Los tests unitarios se ejecutan en una zona horaria distinta de Madrid a propósito:
// así se detecta cualquier cálculo que dependa de la zona del navegador.
process.env.TZ = 'America/New_York'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    environment: 'node',
  },
})
