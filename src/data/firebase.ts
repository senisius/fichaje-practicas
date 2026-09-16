import { initializeApp, type FirebaseOptions } from 'firebase/app'
import { connectAuthEmulator, getAuth } from 'firebase/auth'
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache } from 'firebase/firestore'

export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true'
export const EMULATOR_PROJECT_ID = 'demo-fichaje'
export const EMULATOR_FIRESTORE_PORT = 8181
export const EMULATOR_AUTH_PORT = 9099

const emulatorConfig: FirebaseOptions = {
  apiKey: 'demo-api-key',
  authDomain: `${EMULATOR_PROJECT_ID}.firebaseapp.com`,
  projectId: EMULATOR_PROJECT_ID,
  appId: 'demo-app',
}

const envConfig: FirebaseOptions = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const firebaseConfigured = USE_EMULATORS || Boolean(envConfig.apiKey && envConfig.projectId)

// Sin configuración, getAuth() lanzaría auth/invalid-api-key al importar este módulo y App no podría
// mostrar las instrucciones. Se usa un relleno que nunca conecta: App se queda en SetupScreen.
const unconfigured: FirebaseOptions = { apiKey: 'sin-configurar', projectId: 'sin-configurar', appId: 'sin-configurar' }

const config = USE_EMULATORS ? emulatorConfig : firebaseConfigured ? envConfig : unconfigured

export const app = initializeApp(config)
export const auth = getAuth(app)
// Caché en memoria: la fuente de verdad es siempre el servidor y las escrituras
// importantes van por transacción, que exige conexión.
export const db = initializeFirestore(app, { localCache: memoryLocalCache() })

if (USE_EMULATORS) {
  connectAuthEmulator(auth, `http://127.0.0.1:${EMULATOR_AUTH_PORT}`, { disableWarnings: true })
  connectFirestoreEmulator(db, '127.0.0.1', EMULATOR_FIRESTORE_PORT)
}
