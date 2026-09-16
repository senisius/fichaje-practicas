# Contrato de implementación — Fichaje Prácticas

Especificación compartida por todas las partes del proyecto. El diseño razonado completo está en
`docs/PROPUESTA.md` (§3.A, §4 y §5 son la referencia de Firebase; §3.B/§4.B es un plan B que **no** se implementa).
Si algo de aquí contradice a PROPUESTA.md, manda este fichero.

## Decisiones confirmadas por el usuario

- Web instalable (PWA) llamada **"Fichaje Prácticas"**, con **icono propio** (reloj/cronómetro, verde).
- **Logo oficial de la UAB** pequeño en la cabecera, **sin modificarlo**, cargado desde `public/brand/uab-logo.svg`
  (o `.png`). El usuario lo descargará él de https://www.uab.cat/ca/identitatcorporativa tras consultarlo con su
  profesora. **Nadie en este proyecto descarga ni dibuja el logo de la UAB.** Si el fichero no existe, la cabecera
  lo oculta sin romperse (`onError` → ocultar). Pie de página y pantalla de login: aviso
  **"Herramienta personal, no oficial de la UAB. No uses aquí tu contraseña de la UAB."**
  La pantalla de login no debe imitar el acceso oficial de la UAB (nada de "Accés UAB", SSO, NIU, etc.).
- Stack: Vite 8 + React 19 + TypeScript (SPA, sin router), Firebase Spark (Auth email/contraseña + Firestore
  Standard `europe-southwest1`) + Firebase Hosting. Sin Cloud Functions.
- Límites de entradas manuales: máx. 31 días atrás, máx. 16 h por entrada, nota obligatoria (≥ 5), no antes de
  `program_start`, no en el futuro. Aviso (no bloqueo) si solapa o si el día supera 10 h.
- Backup semanal automático con una tercera cuenta `backup` de solo lectura + GitHub Actions (repo privado).
- Registro público cerrado (Identity Platform) + reglas que niegan todo a cuentas sin `users/{uid}`.
- Idioma de la interfaz: **español**. Zona horaria: **Europe/Madrid** siempre, independientemente del navegador.
- Usuarios: un student y una supervisora (usa "tu profesora"/"la supervisora" en textos; sin nombres propios en el código).

## Estructura y propiedad de ficheros

Cada parte solo escribe en sus ficheros. Si necesitas algo de otra parte, **no lo edites**: déjalo anotado en tu informe.

| Parte | Ficheros |
|---|---|
| Base (ya hecha, no tocar salvo indicación) | `package.json`, `firebase.json`, `firestore.indexes.json`, `vitest*.config.ts`, `tsconfig*.json`, `vite.config.ts`, `.env.*`, `src/types.ts`, `src/lib/limits.ts`, `src/data/firebase.ts`, `src/vite-env.d.ts` |
| Reglas | `firestore.rules`, `tests/rules/**` |
| Datos | `src/lib/time.ts`, `src/lib/validation.ts`, `src/data/api.ts`, `src/data/AppDataProvider.tsx`, `src/data/export.ts`, `src/**/*.test.ts` de esos módulos |
| Interfaz | `src/main.tsx`, `src/App.tsx`, `src/index.css`, `src/ui/**` |
| PWA y operación | `index.html`, `public/**` (salvo `public/brand/uab-logo.*`), `scripts/**`, `.github/workflows/**`, `README.md`, `docs/DESPLIEGUE.md` |

Las firmas exportadas de `src/lib/time.ts`, `src/lib/validation.ts`, `src/data/api.ts`, `src/data/AppDataProvider.tsx`
y `src/data/export.ts` son el contrato: la parte de Datos las implementa **sin cambiarlas** (puede añadir exports);
la parte de Interfaz las usa tal cual.

## Modelo de datos (Firestore)

Ver `src/types.ts`. Resumen:

- `users/{uid}`: `role` ('student'|'supervisor'|'backup'), `name`, `email?`, `target_hours?` (student: 298),
  `program_start?` (Timestamp, student). Solo se crean a mano en la consola.
- `sessions/{sid}`: `owner, method, start_time, end_time|null, adjusted, adjust_reason, voided, void_reason, note,
  rev, created_at, updated_at`. Exactamente estas 12 claves. `status` y duración se derivan. `rev` es un entero.
  Al crearla, `sid` tiene el formato de los ids automáticos (`doc(collection(...))`: 20 letras y números).
- `sessions/{sid}/revisions/{rev}`: `{ before: <copia exacta de la sesión antes del cambio>, at }`. El id es
  `String(rev anterior)`. Append-only.
- `live/{uid}`: `{ session_id }`. Existe solo mientras hay sesión abierta. Garantiza una sola sesión abierta.
- `comments/{cid}`: `session_id, session_owner, author_uid, text, created_at`. Solo la supervisora crea. Append-only.
- `meta/backup`: `last_backup_at, docs`. Solo lo escribe la cuenta `backup`.

Transiciones permitidas de una sesión (todas con revisión en el mismo commit, `rev + 1`, `updated_at = serverTimestamp()`):

1. **START** (crear live): transacción que lee `live/{uid}`, crea `sessions/{nuevo}` con `start_time = created_at =
   updated_at = serverTimestamp()`, `end_time = null`, `rev = 0`, y crea `live/{uid} = {session_id}`.
2. **STOP normal**: `end_time = serverTimestamp()`, `adjusted = false`, `adjust_reason = ''`, `note` (puede cambiar),
   borra `live/{uid}`. Solo si `now - start <= 16 h`.
3. **STOP ajustado** (olvidé parar): `end_time` = hora tecleada (Madrid → UTC), `start < end < now`,
   `end - start <= 16 h`, `adjusted = true`, `adjust_reason` 10–500 caracteres, borra `live/{uid}`.
4. **Nota**: solo cambia `note` (en manuales ≥ 5 caracteres). Permitido en sesiones abiertas o cerradas, no anuladas.
5. **Anular**: solo sesiones cerradas y no anuladas; `voided = true`, `void_reason` 10–500. Irreversible.
6. **Manual** (crear): `method = 'manual'`, `start_time` = fecha + hora (09:00 por defecto) en Madrid → UTC,
   `end_time = start + minutos`, `created_at = updated_at = serverTimestamp()`, `rev = 0`, nota 5–2000.

Nada más: no se borran sesiones, no se cambian horas de sesiones cerradas, nadie escribe en `users`.

## Permisos

| Colección | student | supervisor | backup | sin perfil / anónimo |
|---|---|---|---|---|
| `users` | leer | leer | leer | nada |
| `sessions` | leer las suyas (consultas con `where('owner','==',uid)`); crear/actualizar según transiciones | leer todas | leer todas | nada |
| `sessions/*/revisions` | leer las suyas; crear solo junto al cambio | leer | leer | nada |
| `live` | leer/crear/borrar el suyo junto a su sesión | leer todos | leer | nada |
| `comments` | leer los de sus sesiones (`where('session_owner','==',uid)`) | leer todos; crear como autora | leer | nada |
| `meta/backup` | leer | leer | leer; crear/actualizar con `last_backup_at = serverTimestamp()` | nada |

## Interfaz (resumen funcional)

Común:
- Pantallas: cargando, login (email + contraseña, "He olvidado mi contraseña", aviso no oficial), sin perfil
  ("Tu cuenta no tiene acceso; pide al administrador que la dé de alta"), sin configuración de Firebase
  (`firebaseConfigured === false` → instrucciones para crear `.env.local`), app.
- Cabecera: icono de la app + "Fichaje Prácticas" + logo UAB (si existe) + nombre y rol del usuario + menú
  (cambiar contraseña, exportar CSV/JSON, cerrar sesión).
- Banner sin conexión (`useOnline`): los botones que escriben se desactivan.
- Indicador de backup: fecha del último backup; aviso si han pasado más de 10 días (exactos) o si no hay ninguno.
  El workflow solo marca `meta/backup` cuando la copia cifrada ya está subida.
- Progreso: horas hechas / 298 h (`target_hours` si es un número > 0), barra, %, restante, desglose en vivo /
  manual, nº de ajustadas, fecha estimada de fin (`estimateFinish` con `program_start`: en el primer mes el
  ritmo usa las semanas reales transcurridas; "sin ritmo reciente" si no hay). Las horas cuentan con segundos;
  a la vista, lo hecho se trunca al minuto, lo restante se redondea hacia arriba y el % se trunca a una décima.
  La sesión abierta se muestra aparte como "+ en curso", con tope de 16 h; pasadas 16 h, "pendiente de indicar
  la hora de fin" (sin franja en la barra).
- Historial agrupado por semana (total válido por semana). Cada sesión: fecha, horario (manual: "aprox."),
  duración, método, estado y etiquetas (`computeFlags`): "fin ajustado", "anulada" (tachada), "nota editada (n)",
  "registrada X días después", "solapa con…", "día > 10 h", nº de comentarios.
- Detalle de sesión (panel/modal): todos los datos, motivos, comentarios en orden, historial de revisiones
  (`useRevisions`) mostrando qué cambió en cada una.
- Accesible (labels, foco, contraste AA, `aria-live` para errores/estado), responsive (móvil primero, ~360 px) y
  con modo oscuro por `prefers-color-scheme`.
- Errores siempre con `friendlyError`. Botones deshabilitados mientras una operación está pendiente; mientras
  tanto, los paneles con un formulario no se pueden cerrar, y si tienen texto sin guardar piden confirmación.
- Si falla una suscripción (`AppData.failed`), no se muestran como reales los datos vacíos de esa fuente.
  Mientras no llega la primera respuesta del servidor, se muestra la carga (no la caché vacía).
- Escrituras idempotentes ante los reintentos del SDK: un intento anterior que llegó a guardarse no se duplica
  ni se informa como error; un STOP no da por bueno un cierre distinto hecho desde otro dispositivo.

Student:
- Tarjeta de fichaje: botón grande EMPEZAR / PARAR, cronómetro (`useNow` + `serverSkewMs`), hora de inicio,
  campo de nota. La nota se guarda al parar o con el botón «Guardar nota» (`editSessionNote`, con revisión; no hay
  guardado automático); hasta entonces es un borrador en `localStorage` por id de sesión, que se restaura al
  volver, se borra al parar o guardar y al cerrar sesión. Aviso a partir de 10 h. Pasadas 16 h, PARAR se sustituye por "¿A qué hora terminaste?"
  (hora Madrid + motivo, `validateAdjustedStop`). También hay un enlace "Terminé antes / olvidé parar" disponible
  en cualquier momento para el cierre ajustado.
- Añadir horas a mano: fecha (por defecto hoy), hora opcional, duración (horas + minutos), nota.
  `validateManual`: errores bloquean, avisos piden confirmación.
- Detalle: editar nota, anular con motivo (confirmación explícita, irreversible), ver comentarios de la profesora.

Supervisor:
- Indicador en tiempo real "En curso desde HH:MM (lleva X)" si el student tiene sesión abierta.
- Mismo progreso e historial (del student), sin ningún control de edición.
- Filtros: todas / en vivo / manuales / con marcas / anuladas.
- Detalle: caja para comentar (`validateComment`, `addComment`), comentarios previos, revisiones.

## Comandos

- `npm run dev:emu` — app contra emuladores (necesita `npm run emulators` en otra terminal y `npm run seed`).
- `npm run test` — tests unitarios (TZ = America/New_York a propósito).
- `npm run test:rules` — tests de reglas en el emulador (Java 21 en el PATH).
- `npm run test:integration` — `src/data/api.ts` real + reglas reales + seed + backup contra emuladores de Auth y
  Firestore (Java 21 en el PATH; `tests/integration`, `vitest.integration.config.ts` carga `.env.emulator`).
- `npm run build` — typecheck + build. `npm run lint` — oxlint.
- `npm run e2e` — recorrido con Chrome sin interfaz (`scripts/e2e.mjs`) contra `npm run dev:emu`, con los
  emuladores y `npm run seed -- --open` en marcha.
- Emuladores: Auth 9099, Firestore **8181** (el 8080 está ocupado en este equipo), UI 4000. Proyecto `demo-fichaje`.

## Cuentas del emulador (las crea `npm run seed`)

| email | contraseña | rol |
|---|---|---|
| `estudiante@demo.test` | `demo-estudiante` | student (target 298, program_start = hace 60 días) |
| `profesora@demo.test` | `demo-profesora` | supervisor |
| `backup@demo.test` | `demo-backup` | backup |
| `sinperfil@demo.test` | `demo-sinperfil` | (sin documento users) |

El seed también crea ~25 sesiones de ejemplo del student (live y manuales, alguna ajustada, una anulada, una con
nota editada con su revisión, un solape, un día > 10 h, una registrada tarde) y algunos comentarios.
