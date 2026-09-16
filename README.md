# Fichaje Prácticas

Web instalable (PWA) para registrar las horas de unas prácticas (objetivo: **298 h**).

- **El estudiante** ficha la entrada y la salida con la hora del servidor. También puede añadir horas a mano (con límites), corregir la nota o anular una sesión indicando el motivo. Ve su progreso, la fecha estimada de fin y un historial por semanas.
- **La supervisora** (su profesora) lo ve todo en tiempo real: la sesión en curso, las marcas de revisión (fin ajustado, solapes, días de más de 10 h, entradas tardías…) y el historial de cambios. Puede dejar comentarios.
- **Ambos** pueden exportar a CSV y JSON.
- **Copia de seguridad:** un workflow de GitHub Actions hace cada semana una copia cifrada.

> Herramienta personal, **no oficial de la UAB**. No uses en ella tu contraseña de la UAB.

La especificación está en [`docs/CONTRATO.md`](docs/CONTRATO.md) y el diseño razonado en [`docs/PROPUESTA.md`](docs/PROPUESTA.md) (§3.A, §4 y §5). La guía de puesta en marcha, paso a paso, está en [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md).

## Stack

| Capa | Tecnología |
|---|---|
| Interfaz | Vite 8 + React 19 + TypeScript. Página única (SPA) sin router: la vista depende del rol |
| Datos y login | Firebase, plan Spark: Authentication con email y contraseña, y Cloud Firestore Standard en `europe-southwest1`. SDK `firebase` 12 |
| Seguridad | `firestore.rules`: toda la autorización y la integridad. No hay Cloud Functions |
| Fechas | `date-fns` 4 + `date-fns-tz` 3. Todo se muestra en `Europe/Madrid`, sea cual sea la zona del navegador |
| Hosting | Firebase Hosting (`https://<proyecto>.web.app`) |
| Desarrollo | Emuladores de Firebase (`firebase-tools` 15, necesitan Java 21), `vitest` 5, `@firebase/rules-unit-testing` 5, `oxlint` |
| Backup | `scripts/backup.mjs` + GitHub Actions (cada semana, cifrado con GPG) |

## Estructura

```text
.
├── index.html                  Página base de Vite (metadatos PWA)
├── public/                     Iconos, manifest, service worker (sw.js) y página sin conexión
│   └── brand/                  Aquí va uab-logo.svg (no se incluye; la carpeta existe gracias a .gitkeep; ver docs/DESPLIEGUE.md, paso 10)
├── src/
│   ├── main.tsx, App.tsx       Arranque y selección de pantalla según el estado y el rol
│   ├── types.ts                Modelo de datos de Firestore
│   ├── lib/                    Lógica pura: tiempo y progreso (time.ts), validaciones (validation.ts), límites (limits.ts)
│   ├── data/                   Firebase: configuración, acciones (api.ts), suscripciones (AppDataProvider.tsx, sources.ts,
│   │                           auth-state.ts), borrador local de la nota (note-draft.ts), exportación
│   ├── ui/                     Componentes de interfaz (el logo de la UAB se carga en Brand.tsx)
│   └── pwa.ts                  Registro del service worker
├── tests/
│   ├── rules/                  Tests de firestore.rules (en el emulador)
│   └── integration/            api.ts, suscripciones, seed y backup contra los emuladores
├── scripts/
│   ├── seed-emulator.mjs       Datos de ejemplo para los emuladores
│   ├── backup.mjs              Copia de seguridad con la cuenta técnica "backup"
│   ├── e2e.mjs                 Recorrido de extremo a extremo con Chrome sin interfaz
│   └── gen-icons.mjs           Genera los PNG de la PWA a partir de los SVG
├── .github/workflows/backup.yml  Backup semanal cifrado
├── firestore.rules, firestore.indexes.json, firebase.json
├── vitest.config.ts, vitest.rules.config.ts, vitest.integration.config.ts   Configuración de los tres tipos de test
├── .env.example                Plantilla de .env.local (configuración web de Firebase)
├── .env.emulator               Modo emulador (npm run dev:emu)
└── docs/                       CONTRATO.md, PROPUESTA.md, DESPLIEGUE.md
```

## Scripts de `package.json`

| Comando | Qué hace |
|---|---|
| `npm run dev` | Arranca la app en local (http://localhost:5173) contra el proyecto real configurado en `.env.local` |
| `npm run dev:emu` | Arranca la app en local contra los emuladores (`--mode emulator`, lee `.env.emulator`) |
| `npm run emulators` | Arranca los emuladores de Auth (9099) y Firestore (8181), con la interfaz en http://127.0.0.1:4000 (proyecto `demo-fichaje`) |
| `npm run seed` | Borra los datos de los emuladores y crea cuentas, perfiles, unas 25 sesiones y comentarios de ejemplo. Con `npm run seed -- --open`, añade además una sesión en curso |
| `npm run build` | Comprueba los tipos (`tsc -b`) y genera la versión de producción en `dist/` |
| `npm run preview` | Sirve `dist/` en local (http://localhost:4173) |
| `npm run lint` | Revisa el código con oxlint |
| `npm run typecheck` | Solo comprueba los tipos (`tsc -b`) |
| `npm run test` | Tests unitarios con vitest. Se ejecutan con `TZ=America/New_York` a propósito |
| `npm run test:rules` | Arranca un emulador de Firestore temporal y ejecuta los tests de `firestore.rules` |
| `npm run test:integration` | Arranca emuladores temporales de Auth y Firestore y prueba de verdad `src/data/api.ts` con las reglas reales, además del seed y el backup |
| `npm run icons` | Regenera los PNG de los iconos a partir de los SVG de `public/` |
| `npm run deploy` | `build` + `firebase deploy --only hosting,firestore`: publica la web, las reglas y los índices |
| `npm run deploy:rules` | Publica solo las reglas y los índices de Firestore |
| `npm run backup -- --emulator` | Copia de seguridad de los emuladores en `backups/`. Contra el proyecto real la hace el workflow de GitHub (ver `docs/DESPLIEGUE.md`, 13.3 y 13.6) |
| `npm run e2e` | Recorrido de extremo a extremo con Chrome sin interfaz (ver "Recorrido E2E") |

## Desarrollo local con emuladores

No necesitas ningún proyecto real: los emuladores usan el proyecto ficticio `demo-fichaje`.

1. **Requisitos**
   - Node.js 22.12 o superior (se recomienda la LTS actual). Compruébalo con `node -v`.
   - **Java 21** (JDK), para los emuladores. Compruébalo con `java -version`. Si Java no está en el PATH, en Git Bash:
     ```bash
     export PATH="/c/ruta/a/jdk-21/bin:$PATH"
     ```
2. **Instalar las dependencias** en la carpeta del proyecto:
   ```bash
   npm ci
   ```
3. **Terminal 1: arrancar los emuladores** y dejarlos abiertos:
   ```bash
   npm run emulators
   ```
   - Auth usa el puerto 9099, Firestore el **8181** (no el 8080 habitual, que en el equipo de desarrollo está ocupado) y la interfaz está en http://127.0.0.1:4000.
   - La primera vez descargan los ficheros del emulador.
   - Los datos se pierden al pararlos.
4. **Terminal 2: cargar los datos de ejemplo.** El seed borra todo lo que haya en los emuladores y vuelve a crearlo. Repítelo cuando quieras empezar de cero.
   ```bash
   npm run seed            # o bien: npm run seed -- --open   (con una sesión en curso desde hace 2 h)
   ```
5. **Terminal 2: arrancar la app** y abrir http://localhost:5173:
   ```bash
   npm run dev:emu
   ```
6. **Entrar con una de las cuentas de ejemplo.** Solo existen en el emulador:

   | Email | Contraseña | Rol |
   |---|---|---|
   | `estudiante@demo.test` | `demo-estudiante` | student (objetivo 298 h, inicio hace 60 días) |
   | `profesora@demo.test` | `demo-profesora` | supervisora |
   | `backup@demo.test` | `demo-backup` | backup (solo lectura) |
   | `sinperfil@demo.test` | `demo-sinperfil` | sin documento `users`: debe ver "Tu cuenta no tiene acceso" |

   Los datos de ejemplo incluyen:
   - sesiones en vivo y manuales;
   - dos cierres ajustados;
   - una sesión anulada;
   - una nota editada;
   - una entrada manual que se solapa con un fichaje;
   - un día de más de 10 h;
   - una entrada registrada 5 días tarde;
   - seis comentarios de la profesora;
   - un último backup de hace 3 días.
7. **Opcional: probar el backup** contra los emuladores. El fichero se guarda en `backups/`, que Git ignora:
   ```bash
   npm run backup -- --emulator
   ```

Para ver o tocar los datos a mano, usa la interfaz del emulador (http://127.0.0.1:4000). El Admin SDK del seed y la interfaz se saltan las reglas; la app no.

## Tests

```bash
npm run test         # unitarios (src/**/*.test.ts)
npm run test:rules   # reglas de Firestore (necesita Java 21)
npm run test:integration   # api.ts + reglas + seed + backup contra emuladores (necesita Java 21)
npm run lint
npm run build        # incluye la comprobación de tipos
```

`npm run test:rules` y `npm run test:integration` arrancan sus propios emuladores (Firestore en el 8181 y, el segundo, también Auth en el 9099). Si tienes `npm run emulators` abierto, páralo antes (Ctrl+C) o fallarán porque los puertos están ocupados. Los tests de integración borran los datos de esos emuladores temporales, nunca los de un proyecto real.

Pasa los tests de reglas **antes de cada despliegue** que cambie `firestore.rules`.

### Recorrido E2E

`npm run e2e` abre Chrome sin interfaz y recorre la app como lo haría una persona: fichar, nota de la sesión (también tras recargar), cierre ajustado, entrada manual, detalle, anulación, vista de la supervisora, comentarios y cuentas sin permisos. No añade dependencias: usa el protocolo de depuración de Chrome.

1. Terminal 1: `npm run emulators`.
2. Terminal 2: `npm run seed -- --open` (repítelo antes de cada ejecución: el recorrido parte de esos datos) y después `npm run dev:emu`.
3. Terminal 3: `npm run e2e`. Termina con `E2E OK` o con la lista de fallos.

Variables de entorno opcionales:

| Variable | Para qué |
|---|---|
| `E2E_CHROME` | Ruta de Chrome o Chromium, si no está en la ruta habitual |
| `E2E_BASE` | URL de la app (por defecto `http://localhost:5173`) |
| `E2E_MODE` | `full` (por defecto), `smoke` (solo la pantalla inicial) u `over16` (envejece la sesión sembrada a 17 h y prueba el cierre ajustado y el modo sin conexión) |
| `E2E_SHOTS` | Carpeta donde guardar capturas de pantalla |
| `E2E_PROFILE`, `E2E_PORT` | Perfil temporal de Chrome (se borra al terminar) y puerto de depuración (9333) |
| `E2E_SW` | `1` para comprobar el service worker y la página sin conexión (solo contra `npm run preview`, con `E2E_BASE=http://localhost:4173`) |

En Git Bash, por ejemplo: `E2E_MODE=over16 npm run e2e` (después de un `npm run seed -- --open` nuevo).

## Despliegue

Sigue [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). Explica, paso a paso:
- cómo crear el proyecto de Firebase, Firestore, Authentication, las cuentas y los perfiles;
- cómo rellenar `.env.local` y desplegar con `npm run deploy`;
- cómo instalar la app en el móvil y añadir el logo;
- cómo restringir las API keys;
- cómo configurar el backup en GitHub;
- la rutina mensual y la solución de problemas.

## Modelo de seguridad (resumen)

- **Las reglas son la barrera.** La configuración web de Firebase es pública. La seguridad la imponen `firestore.rules`, que se despliegan junto con la web, y la base de datos se crea en modo producción.
- **Roles.** Cada rol está en `users/{uid}` (`student`, `supervisor` o `backup`). Estos documentos se crean a mano en la consola y nadie puede escribir en `users` desde la app.
- **Cuentas sin perfil.** Una cuenta sin documento `users/{uid}` no puede leer ni escribir nada. Además, el registro público se cierra con Identity Platform y la app no tiene pantalla de registro.
- **Hora del servidor.** Al empezar y al parar una sesión normal, la hora la pone el servidor (`request.time`). El cerrojo `live/{uid}` garantiza que solo haya una sesión abierta, aunque haya dos pestañas o dos dispositivos.
- **Transacciones.** Las escrituras de sesiones van en transacciones, que fallan sin conexión: nunca se queda un fichaje en cola. El service worker no guarda datos.
- **Sesiones inmutables.** Las sesiones no se borran y las horas de una sesión cerrada no cambian. Solo se puede:
  - editar la nota;
  - anular la sesión, con un motivo y de forma irreversible;
  - cerrar con un fin ajustado, con un motivo.

  Cada cambio guarda en el mismo commit una **revisión** (append-only) con el estado anterior.
- **Entradas manuales.** Estos límites los comprueban las reglas:
  - como mucho 31 días de antigüedad;
  - como mucho 16 h;
  - nada en el futuro;
  - nada anterior a `program_start`;
  - nota de al menos 5 caracteres.
- **Supervisora.** Solo lee y crea comentarios (append-only), y las reglas comprueban el `session_owner`.
- **Cuenta `backup`.** Solo lee y escribe `meta/backup`, con la hora del servidor. El workflow marca `meta/backup` al final, cuando la copia cifrada ya está subida: el indicador nunca da por buena una copia que no existe.
- **Ids de sesión.** Las reglas solo aceptan sesiones nuevas con ids como los automáticos (20 letras y números), y la exportación CSV neutraliza cualquier texto que Excel pudiera tomar como fórmula (también en la columna Id).
- **API keys.**
  - La clave web solo acepta peticiones desde el sitio de la app.
  - El backup usa otra clave, limitada a las APIs de Auth y Firestore.
  - Las credenciales del backup están en los secrets de GitHub.
  - La copia se cifra con GPG (AES-256) antes de subirla.
- **La consola de Firebase.** El propietario del proyecto puede editar datos desde la consola. Por eso:
  - las revisiones dejan rastro de los cambios hechos desde la app;
  - la profesora guarda su propio CSV mensual;
  - **no** se la añade como miembro del proyecto.

## Limitaciones conocidas

- **Solapes y días de más de 10 h.** Las reglas no pueden hacer consultas, así que no se bloquean. Solo se avisa antes de guardar y se marcan para la supervisora.
- **Plan Spark.**
  - La documentación de Firebase no menciona pausas ni borrados por inactividad, pero eso **no es una garantía contractual**.
  - Las cuotas diarias (50.000 lecturas, 20.000 escrituras) cortan el servicio si se superan.
- **Sin backups gestionados.** Los backups y la restauración a un momento anterior (PITR) de Firestore son de pago. Por eso se usan el workflow semanal y el CSV mensual.
  - Los artifacts de GitHub caducan a los 90 días.
  - No hay script de restauración: el procedimiento está resumido en `docs/DESPLIEGUE.md`.
- **Workflows programados.** GitHub desactiva los workflows programados de los repos públicos tras 60 días sin actividad; para los privados no está documentado. La app avisa si el último backup tiene más de 10 días.
- **Sin conexión no se puede fichar.** Es a propósito: así la hora siempre es la del servidor.
- **Nota de la sesión en curso.** Se guarda en el servidor al parar o con «Guardar nota» (que deja una revisión: la supervisora la ve como "nota editada"). Mientras tanto se conserva solo en ese navegador (`localStorage`) y sobrevive a recargas y cierres; se borra al cerrar sesión. Si la sesión se para desde otro dispositivo, la app muestra el texto que no llegó a guardarse para que se pueda añadir con «Editar nota».
- **Minutos y segundos.** Las horas cuentan con el tiempo exacto (segundos incluidos). Cada sesión se muestra en minutos completos, así que la suma de las filas de una semana puede quedar algún minuto por debajo de su total; lo restante se redondea al minuto hacia arriba para que "hecho + restante" cuadre con el objetivo. En el CSV pasa lo mismo: la fila TOTAL VÁLIDO es la cifra de referencia.
- **Una cuenta comprometida puede agotar la cuota.** Las reglas no limitan la frecuencia de escritura: con la contraseña del estudiante o de la supervisora se podrían crear miles de entradas o comentarios (que no se pueden borrar desde la app) y agotar la cuota diaria de Spark. La recuperación está en `docs/DESPLIEGUE.md` (paso 15).
- **Hora de las entradas manuales.** Si no se indica hora, empiezan a las 09:00 y se muestran como "aprox.".
- **Usuarios.** Está pensada para un estudiante y una supervisora.
- **Logo de la UAB.** No se incluye en el repositorio. Lo añade el usuario tras consultarlo con su profesora.
