import { defineConfig } from 'vitest/config'

// Tests de firestore.rules. Se lanzan con `npm run test:rules`, que arranca el emulador.
export default defineConfig({
  test: {
    include: ['tests/rules/**/*.test.ts'],
    environment: 'node',
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
