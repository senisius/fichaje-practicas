# Guía de despliegue: Fichaje Prácticas

Esta guía te lleva desde cero hasta tener la app publicada en `https://<proyecto>.web.app`, instalada en el móvil y con un backup semanal automático.

- **Tiempo:** una tarde, sin prisas.
- **Coste:** ninguno. Todo cabe en el plan gratuito **Spark** de Firebase y en una cuenta gratuita de GitHub.
- **Cómo leer la guía:**
  - **Pulsa:** lo que tienes que hacer.
  - **Comprueba:** cómo saber que ha salido bien.

La consola de Firebase cambia de vez en cuando: si un botón no está exactamente donde se indica, búscalo por su nombre. Entre paréntesis va el nombre en inglés, por si tienes la consola en inglés.

## Chuleta de nombres

| Qué | Nombre exacto |
|---|---|
| Fichero de configuración local | `.env.local` (copia de `.env.example`) |
| Variables de `.env.local` | `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID` |
| Secrets de GitHub | `FIREBASE_API_KEY_BACKUP`, `FIREBASE_PROJECT_ID`, `BACKUP_EMAIL`, `BACKUP_PASSWORD`, `BACKUP_PASSPHRASE` |
| Workflow de backup | `.github/workflows/backup.yml` (en GitHub aparece como **Backup semanal**) |
| Desplegar todo / solo reglas | `npm run deploy` / `npm run deploy:rules` |
| Backup a mano | **Actions › Backup semanal › Run workflow** (13.3). En local, solo contra los emuladores: `npm run backup -- --emulator` (contra el proyecto real, ver 13.6) |
| Recorrido E2E (emuladores) | `npm run e2e` (ver `README.md`) |
| Emuladores | `npm run emulators` (Auth 9099, Firestore 8181, interfaz 4000), `npm run seed`, `npm run dev:emu` |
| Logo de la UAB | `public/brand/uab-logo.svg` (se carga en `src/ui/Brand.tsx`) |
| Copias locales | carpeta `backups/` (Git la ignora) |

---

## 1. Requisitos

1. **Cuenta de Google personal** (no la de la UAB: podría tener restricciones o desaparecer al terminar los estudios) con **verificación en dos pasos**.
   - **Pulsa:** https://myaccount.google.com › Seguridad › Verificación en dos pasos › Activar.
   - **Comprueba:** en Seguridad aparece "Verificación en dos pasos: activada".
2. **Node.js** 22.12 o superior. Se recomienda la versión LTS actual (https://nodejs.org).
   - Node 20 basta para compilar y desplegar, pero ya no tiene soporte, y los tests y el seed necesitan Node 22 o superior.
   - **Comprueba:** `node -v` muestra `v22.12` o superior.
3. **Git** para Windows (https://git-scm.com). Incluye **Git Bash** y `gpg`, que usarás para descifrar los backups.
   - **Comprueba:** en Git Bash, `git --version` y `gpg --version` responden.
   - Si es la primera vez que usas Git, configura tu nombre y tu email:
     ```bash
     git config --global user.name "Tu nombre"
     git config --global user.email "tu-email@ejemplo.com"
     ```
4. **Cuenta de GitHub** (https://github.com), con verificación en dos pasos.
5. **Java 21**, solo si vas a usar los emuladores o pasar los tests de reglas (`npm run emulators`, `npm run test:rules`). Para desplegar no hace falta.
   - **Comprueba:** `java -version` muestra `21` o superior.
6. **Instala las dependencias.** Abre Git Bash en la carpeta del proyecto y ejecuta:
   ```bash
   npm ci
   ```

> **Consejo:** antes de tocar nada real, prueba la app con los emuladores (ver `README.md` › Desarrollo local). Lo que hagas allí no deja rastro.

## 2. Crear el proyecto de Firebase

1. **Pulsa:** https://console.firebase.google.com › **Crear un proyecto** (*Create a project*).
2. **Pon un nombre**, por ejemplo `fichaje-practicas`.
   - Debajo verás el **ID del proyecto**. Puedes editarlo, y formará parte de la URL: `https://<ID>.web.app`.
   - **No se puede cambiar después.** Elige algo sobrio, sin datos personales que no quieras publicar.
3. **Acepta las condiciones.**
   - Si te ofrece Gemini u otras ayudas de IA, puedes desactivarlas.
   - Desactiva **Google Analytics**: no hace falta.
4. **Pulsa:** **Crear proyecto** y espera a que termine.
5. **Comprueba que estás en el plan Spark.** Abajo a la izquierda de la consola debe poner **Spark** (sin coste).
   - Si en algún momento te pide pasar al plan **Blaze** o añadir una tarjeta, **cancela**: esta app no lo necesita.

## 3. Crear la base de datos Firestore

1. **Pulsa:** en el menú lateral, **Firestore Database** (en la consola nueva, dentro de **Databases & Storage › Firestore**) › **Crear base de datos** (*Create database*).
2. **Edición:** si te pregunta, elige **Standard**.
3. **ID de la base de datos:** deja `(default)`.
4. **Ubicación:** `europe-southwest1` (**Madrid**).
   - **La ubicación no se puede cambiar después.** Si te equivocas, tendrías que crear otro proyecto.
5. **Reglas:** **Iniciar en modo de producción** (*Start in production mode*). **Nunca** elijas el modo de prueba: deja la base de datos abierta a cualquiera.
6. **Pulsa:** **Crear**.
7. **Comprueba:**
   - En la pestaña **Reglas** (*Rules*) aparece `allow read, write: if false;`. Es lo correcto por ahora: las reglas de verdad se publican en el paso 8.
   - En la pestaña de datos se ve la ubicación `europe-southwest1`.

## 4. Configurar Authentication

1. **Activa Authentication.**
   - **Pulsa:** en el menú lateral, **Authentication** (en la consola nueva, dentro de **Security › Authentication**) › **Comenzar** (*Get started*).
2. **Activa el login con email y contraseña.**
   - **Pulsa:** pestaña **Método de inicio de sesión** (*Sign-in method*) › **Correo electrónico/contraseña** (*Email/Password*).
   - Activa **solo** el primer interruptor, **Correo electrónico/contraseña**.
   - Deja **desactivado** el de **Vínculo del correo electrónico (acceso sin contraseña)** (*Email link, passwordless sign-in*).
   - **Pulsa:** **Guardar**.
3. **Pon los correos en español.**
   - **Pulsa:** pestaña **Plantillas** (*Templates*) › icono del lápiz o del idioma › **Idioma de la plantilla** (*Template language*) › **Español** › **Guardar**.
   - Así el correo de "He olvidado mi contraseña" llega en español.
4. **Pasa a Identity Platform** para poder cerrar el registro público.
   - **Pulsa:** pestaña **Configuración** (*Settings*) › **Actualizar a Firebase Authentication con Identity Platform** (*Upgrade to Identity Platform*).
   - **Lee con calma el cuadro de diálogo antes de confirmar:**
     - Si **no** pide tarjeta, cuenta de facturación ni el plan Blaze, confirma la actualización.
     - Si **pide tarjeta o el plan Blaze**, **cancela y sáltate este paso y el siguiente**. No pasa nada: las reglas ya dejan sin permisos a cualquier cuenta que no tenga perfil en `users` (paso 6), y la app no tiene pantalla de registro.
5. **Cierra el registro público** (solo si hiciste el paso anterior).
   - **Pulsa:** **Configuración** › **Acciones del usuario** (*User actions*).
   - **Desmarca** **Habilitar creación (registro)** (*Enable create (sign-up)*) y **Habilitar eliminación** (*Enable delete*).
   - **Pulsa:** **Guardar**.
   - **Comprueba:** las dos casillas quedan desmarcadas al recargar la página.

## 5. Crear las tres cuentas

**Pulsa:** **Authentication › Usuarios** (*Users*) › **Añadir usuario** (*Add user*), una vez por cada cuenta:

| Cuenta | Email | Contraseña |
|---|---|---|
| Estudiante (tú) | tu email personal | Una contraseña fuerte y nueva. **No** la de la UAB |
| Profesora | su email | Una contraseña inicial temporal: se la darás en persona (paso 11) |
| Backup | tu email con `+backup`, por ejemplo `tuemail+backup@gmail.com` | Larga y aleatoria (24 caracteres o más), generada y guardada en tu gestor de contraseñas |

- Gmail entrega en tu buzón lo que llega a `tuemail+backup@gmail.com`. Así la cuenta de backup tiene un email distinto sin crear otro buzón.
- Nadie usa la cuenta de backup para entrar en la app: solo la usa el workflow de GitHub.

**Copia el UID de cada cuenta**: es la columna **UID de usuario** (*User UID*). Pégalos en una nota temporal. Los necesitas en el paso siguiente.

**Comprueba:** hay exactamente 3 usuarios y los tres tienen el proveedor de email.

## 6. Crear los perfiles `users/{uid}`

Sin estos documentos nadie puede hacer nada en la app, y es a propósito. La app **nunca** escribe en `users`: los roles solo se crean aquí.

1. **Pulsa:** **Firestore Database** › **Datos** (*Data*) › **+ Iniciar colección** (*Start collection*).
2. **ID de la colección:** `users`.
3. **ID del documento:** pega el **UID del estudiante**. **No** uses "ID automático".
4. **Añade los campos** de la tabla, con el **tipo exacto**, y **pulsa** **Guardar**.

**Documento del estudiante** (`users/<UID del estudiante>`):

| Campo | Tipo | Valor |
|---|---|---|
| `role` | string | `student` |
| `name` | string | Tu nombre, tal como quieras que se vea |
| `email` | string | Tu email |
| `target_hours` | **number** | `298` |
| `program_start` | **timestamp** | Día real de inicio de las prácticas, a las 00:00 |

5. Dentro de la colección `users`, **pulsa** **+ Añadir documento** (*Add document*) y crea los otros dos, también con su UID como ID.

**Documento de la profesora** (`users/<UID de la profesora>`):

| Campo | Tipo | Valor |
|---|---|---|
| `role` | string | `supervisor` |
| `name` | string | Su nombre |
| `email` | string | Su email |

**Documento de backup** (`users/<UID de backup>`):

| Campo | Tipo | Valor |
|---|---|---|
| `role` | string | `backup` |
| `name` | string | `Copia de seguridad` |
| `email` | string | El email `+backup` |

**Cuidado con estos detalles:**
- `role` va en minúsculas, sin espacios y en inglés: `student`, `supervisor` o `backup`.
- `target_hours` debe ser de tipo **number**. Con `"298"` (string), la app lo ignora, usa 298 h y te muestra un aviso para que lo corrijas.
- `program_start` debe ser de tipo **timestamp**, no string.
  - La consola usa la zona horaria de tu ordenador (Madrid).
  - Las entradas manuales no pueden ser anteriores a esta fecha: pon la fecha **real** de inicio.

**Comprueba:**
- Hay 3 documentos en `users`.
- El ID de cada uno coincide carácter por carácter con el UID de la tabla de Authentication.

## 7. Registrar la app web y rellenar `.env.local`

1. **Registra la app.**
   - **Pulsa:** icono del engranaje › **Configuración del proyecto** (*Project settings*) › pestaña **General** › **Tus apps** (*Your apps*) › icono **Web** (`</>`).
   - **Apodo de la app:** `Fichaje Prácticas`.
   - Deja sin marcar "Configurar también Firebase Hosting": se configura en el paso 8.
   - **Pulsa:** **Registrar app**.
2. **Copia la configuración.** Aparece un bloque `const firebaseConfig = { … }`. Si ya lo has cerrado, está en la misma pantalla, en **Configuración del SDK** (*SDK setup and configuration*) › **Config**.
3. **Crea `.env.local`.** En Git Bash, en la carpeta del proyecto:
   ```bash
   cp .env.example .env.local
   ```
4. **Rellena `.env.local`.** Ábrelo con el editor y copia los valores (sin comillas):

| En `firebaseConfig` | En `.env.local` |
|---|---|
| `apiKey` | `VITE_FIREBASE_API_KEY=` |
| `authDomain` | `VITE_FIREBASE_AUTH_DOMAIN=` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID=` |
| `appId` | `VITE_FIREBASE_APP_ID=` |
| `storageBucket`, `messagingSenderId`, `measurementId` | No se usan |

Estos valores **no son secretos**: acaban dentro de la web publicada. La seguridad la ponen las reglas.

Aun así, `.env.local` no se sube a Git: `.gitignore` lo excluye con `*.local`.

**Comprueba:** `npm run dev` y abre http://localhost:5173.
- Debe salir la pantalla de **login**, no "Falta la configuración de Firebase".
- Hasta el paso 8 las reglas lo deniegan todo, así que después de entrar verás "Tu cuenta no tiene acceso". Es normal.
- Si has restringido la API key (paso 12), `localhost:5173` debe estar en la lista.

## 8. Publicar la web y las reglas

1. **Inicia sesión en Firebase desde la terminal** con la cuenta de Google propietaria del proyecto:
   ```bash
   npx firebase login
   ```
   Se abre el navegador. Si no se abre, usa `npx firebase login --no-localhost` y sigue las instrucciones.
2. **Vincula la carpeta al proyecto:**
   ```bash
   npx firebase use --add
   ```
   - Elige tu proyecto con las flechas.
   - Cuando pregunte el alias (*What alias do you want to use for this project?*), escribe `default`.
   - **Comprueba:** se ha creado el fichero `.firebaserc` con tu ID de proyecto. Puede subirse a Git: no es secreto.
3. **Despliega:**
   ```bash
   npm run deploy
   ```
   - Compila la app (necesita `.env.local`, porque los valores se incrustan al compilar).
   - Después publica Hosting, las reglas (`firestore.rules`) y los índices.
   - La primera vez puede preguntar en inglés *No Hosting site detected… Please provide an unique, URL-friendly id for your site*. **Pulsa Enter** para aceptar el ID propuesto, que debe ser el ID del proyecto: si escribes otro, la URL cambia y la restricción de la clave del paso 12 bloquearía la app.
   - Al final muestra `Hosting URL: https://<ID>.web.app`.
4. **Comprueba:**
   - Abre la URL, entra como estudiante y verás tu nombre, el rol y el progreso **0 h 00 min de 298 h**.
   - En **Firestore › Reglas** aparecen las reglas nuevas, con la fecha de hoy.
5. **Haz una prueba real mínima.**
   - **Pulsa:** EMPEZAR, espera un minuto y **pulsa** PARAR. La sesión aparece en el historial.
   - Las sesiones **no se pueden borrar**. Anula la de prueba: abre su detalle › Anular, con el motivo "Prueba de funcionamiento del despliegue".
   - Así queda registrada pero no cuenta en las horas.
6. **Limita las versiones guardadas de Hosting.**
   - **Pulsa:** **Hosting** (en la consola nueva, **Hosting & Serverless › Hosting**) › tabla **Historial de versiones** (*Release history*) › menú ⋮ › **Configuración de almacenamiento de versiones** (*Release storage settings*).
   - Escribe `5` y **pulsa** **Guardar**.
   - Así las versiones antiguas no se acumulan.

Más adelante:
- Cada vez que cambies el código, vuelve a ejecutar `npm run deploy`.
- Si solo cambias las reglas, basta con `npm run deploy:rules`.
- **Antes** de publicar reglas nuevas, pasa `npm run test:rules` y `npm run test:integration` (necesitan Java 21).
- Si cambias los SVG de `public/icons/` o `public/favicon.svg`, regenera los PNG con `npm run icons`.
- Si cambias `public/offline.html` o la lista `PRECACHE` de `public/sw.js`, sube `VERSION` en `public/sw.js`: así los móviles descartan la copia antigua. `offline.html` lleva una copia del icono dentro; actualízala también si cambia el icono.
- En `firebase.json`, la cabecera `X-Frame-Options: DENY` excluye a propósito las rutas `/__/`: el inicio de sesión de Firebase carga `/__/auth/iframe` en móviles y Safari. No la amplíes a `**`.
- No hay cabecera CSP. Si algún día la añades, `offline.html` tiene `<style>` y `<script>` en línea que necesitarán su hash (o `'unsafe-inline'`), y comprueba en la consola del navegador (F12) que no bloquea el SDK de Firebase.

## 9. Instalar la app en el móvil

- **Android (Chrome):** abre la URL › menú **⋮** › **Instalar aplicación** (en versiones antiguas, **Añadir a pantalla de inicio**) › **Instalar**.
- **iPhone (Safari):** abre la URL en **Safari**, no en otro navegador › botón **Compartir** (el cuadrado con la flecha; en algunas versiones está dentro del menú **···**) › **Añadir a pantalla de inicio** › **Añadir**.

**Comprueba:**
- Aparece el icono verde de **Fichaje** en la pantalla de inicio.
- La app se abre sin la barra del navegador.
- Al volver a abrirla sigues con la sesión iniciada. En iPhone, la app instalada guarda sus datos aparte de Safari: la primera vez que la abras puede pedirte iniciar sesión de nuevo.

Fichar necesita conexión: sin red, los botones se desactivan y verás un aviso.

## 10. Logo de la UAB (opcional)

1. **Antes de nada, pregunta a tu profesora** si es adecuado poner el logo en una herramienta personal. El uso de la marca lo regula el **Reglament en matèria de Marques de la UAB**, enlazado desde https://www.uab.cat/ca/identitatcorporativa/marca.
   - La app ya muestra el aviso "Herramienta personal, no oficial de la UAB".
2. **Descarga el logo.** Si te dice que sí, ve a https://www.uab.cat/ca/identitatcorporativa/versions-descarregues-logotip y descarga la **versión principal** del logotipo (*Versió principal del logotip*), **en positivo** (para fondo claro).
3. **Guárdalo** exactamente como `public/brand/uab-logo.svg` (la carpeta `public/brand/` ya existe; solo contiene un `.gitkeep` vacío para que Git la conserve).
   - **No lo modifiques:** ni colores, ni recortes, ni lo abras para "arreglarlo" en un editor.
   - **Si solo hay PNG:**
     1. Guárdalo como `public/brand/uab-logo.png`.
     2. En `src/ui/Brand.tsx` (componente `UabLogo`), cambia `src="/brand/uab-logo.svg"` por `src="/brand/uab-logo.png"`. Puedes buscar `uab-logo` con el buscador de tu editor.
4. **Vuelve a desplegar:** `npm run deploy`.
5. **Comprueba:**
   - El logo aparece pequeño en la cabecera.
   - Si el fichero no existe o el nombre está mal, la cabecera simplemente no lo muestra, sin errores.

## 11. Dar acceso a la profesora

1. **Dale en persona:**
   - la URL (`https://<ID>.web.app`);
   - su email de acceso;
   - la contraseña inicial del paso 5.

   No se la envíes por correo ni por mensajería.
2. **Cuando entre por primera vez,** debe cambiarla en el menú de la cabecera › **Cambiar contraseña**.
3. **Si la olvida,** en la pantalla de login tiene **He olvidado mi contraseña**.
   - El correo llega desde `noreply@<ID>.firebaseapp.com`.
   - Dile que **mire en spam**.
4. **Explícale qué puede hacer:**
   - Ve tus sesiones en tiempo real y puede comentarlas.
   - No puede modificar nada.
   - Conviene que exporte un **CSV** cada mes y lo guarde ella: es su copia independiente.
5. **No la añadas como miembro del proyecto de Firebase ni de Google Cloud.** Tendría acceso a la consola y podría ver o editar los datos directamente, y eso rompe la trazabilidad.

## 12. Restringir las API keys

La clave web se ve en la web publicada. Restringirla evita que se use desde otros sitios o para otras APIs.

1. **Abre las credenciales.**
   - **Pulsa:** https://console.cloud.google.com/apis/credentials. Arriba, en el selector de proyectos, elige tu proyecto.
2. **Localiza la clave web:** **Browser key (auto created by Firebase)**.
   - **Comprueba** con **Mostrar clave** que coincide con `VITE_FIREBASE_API_KEY`.
3. **Restringe los sitios web.**
   - **Pulsa** el nombre de la clave › **Restricciones de aplicaciones** (*Application restrictions*) › **Sitios web** (*Websites*) › **Añadir** cada uno de estos:
     - `<ID>.web.app/*`
     - `<ID>.firebaseapp.com/*`
     - `localhost:5173/*` (para `npm run dev`)
     - `localhost:4173/*` (para `npm run preview`)
4. **Restringe las APIs.**
   - **Pulsa:** **Restricciones de API** (*API restrictions*) › **Restringir clave** (*Restrict key*).
   - Marca estas tres y **desmarca todas las demás** (en proyectos recientes la clave ya viene con una lista larga de APIs marcadas):
     - **Identity Toolkit API** (`identitytoolkit.googleapis.com`)
     - **Token Service API** (`securetoken.googleapis.com`)
     - **Cloud Firestore API** (`firestore.googleapis.com`; en algunas listas aparece como *Google Cloud Firestore API*)
   - **Pulsa:** **Guardar**.
   - Si después de esto la app dice "Tu cuenta no tiene acceso" o el backup falla, abre la consola del navegador (F12) y busca `are blocked`: casi siempre falta un sitio web (12.3) o una de estas tres APIs.
5. **Comprueba:** espera unos 5 minutos (los cambios tardan en aplicarse). Después abre la app publicada, **recarga** y entra: debe funcionar igual.
6. **Crea una segunda clave para el backup.** El script de backup corre en GitHub, fuera de un navegador, y no envía sitio web: la clave web lo rechazaría.
   - **Pulsa:** **+ Crear credenciales** (*Create credentials*) › **Clave de API** (*API key*).
     - Si aparece la opción de autenticar las llamadas con una cuenta de servicio, déjala **sin marcar**.
   - Edita la clave nueva:
     - **Nombre:** `Backup GitHub Actions`.
     - **Restricciones de aplicaciones:** **Ninguna** (*None*).
     - **Restricciones de API:** **Restringir clave**, con las **mismas tres** APIs: Identity Toolkit API, Token Service API y Cloud Firestore API.
   - **Pulsa:** **Guardar**.
   - Copia su valor: será el secret `FIREBASE_API_KEY_BACKUP` (paso 13).
   - **No** la pongas en `.env.local` ni en ningún fichero del repositorio.

## 13. Backup automático con GitHub Actions

### 13.1 Repositorio privado y primera subida

1. **Crea el repositorio.**
   - **Pulsa:** https://github.com/new.
   - **Repository name:** `fichaje-practicas`.
   - Marca **Private**.
   - **No** añadas README, `.gitignore` ni licencia: el repositorio debe estar vacío.
   - **Pulsa:** **Create repository**.
2. **Sube el código.** En Git Bash, dentro de la carpeta del proyecto (cambia `<tu-usuario>`):
   ```bash
   git init -b main        # si la carpeta ya es un repositorio, no pasa nada
   git add .
   git status              # comprueba que NO aparecen .env.local, backups/ ni ficheros .gpg
   git commit -m "Primera versión de Fichaje Prácticas"
   git remote add origin https://github.com/<tu-usuario>/fichaje-practicas.git
   git push -u origin main
   ```
   La primera vez, Git abre el navegador para que inicies sesión en GitHub.
3. **Comprueba:**
   - En GitHub se ven los ficheros, incluido `.github/workflows/backup.yml`.
   - **No** aparece `.env.local`.

### 13.2 Secrets

1. **Genera la frase de paso.** Antes de nada, crea en tu **gestor de contraseñas** una frase larga para cifrar los backups (por ejemplo, 6 palabras aleatorias o 32 caracteres o más) y **guárdala allí primero**.
   - **Sin ella no se puede descifrar ningún backup, y no hay forma de recuperarla.**
2. **Pulsa:** en el repositorio, **Settings › Secrets and variables › Actions › New repository secret**.
3. **Crea estos cinco**, con el nombre exacto:

| Secret | Valor |
|---|---|
| `FIREBASE_API_KEY_BACKUP` | La **segunda** clave de API (paso 12.6), no la web |
| `FIREBASE_PROJECT_ID` | El ID del proyecto (el mismo que `VITE_FIREBASE_PROJECT_ID`) |
| `BACKUP_EMAIL` | El email de la cuenta de backup (`tuemail+backup@gmail.com`) |
| `BACKUP_PASSWORD` | La contraseña de la cuenta de backup |
| `BACKUP_PASSPHRASE` | La frase de paso de cifrado |

4. **Comprueba:** en la lista aparecen los 5 nombres. GitHub no vuelve a mostrar los valores, y es lo normal.

### 13.3 Primera ejecución a mano

1. **Comprueba que Actions está permitido:** **Settings › Actions › General** debe tener Actions habilitado.
2. **Lanza el workflow.**
   - **Pulsa:** pestaña **Actions** › **Backup semanal** › **Run workflow** › rama `main` › **Run workflow**.
3. **Espera 1–2 minutos** a que aparezca la marca verde.
   - Si sale una cruz roja, abre la ejecución, lee el paso que falla y consulta el paso 15.
4. **Comprueba el artifact.** Al final de la página de la ejecución, en **Artifacts**, aparece `fichaje-backup-<fecha>` (la fecha lleva hora, minutos, segundos y milisegundos).
   - Se guarda **90 días**.
5. **Comprueba el indicador.**
   - En la app, el indicador de backup muestra la fecha de hoy.
   - En Firestore aparece el documento `meta/backup`.
   - El workflow lo actualiza en su **último paso** ("Marcar la copia en la app"), solo si la copia se ha cifrado y subido. Si cualquier paso anterior falla, el indicador conserva la fecha de la última copia buena y, pasados 10 días, avisa.
   - Las reglas solo dejan escribir ese documento a la cuenta `backup` y con exactamente dos campos: `last_backup_at` (hora del servidor) y `docs` (entero ≥ 0). `scripts/backup.mjs` ya lo hace así; no cambies ese formato.
6. **Activa los avisos por correo de GitHub Actions.**
   - **Pulsa:** tu foto (arriba a la derecha) › **Settings › Notifications** › **System** › **Actions**: marca **Email** y "Only notify for failed workflows".
   - Sin esto, GitHub no te avisará de que un backup ha fallado.

Después, el workflow se ejecuta solo **cada lunes a las 03:17 UTC** (las 05:17 en Madrid en verano y las 04:17 en invierno).
- GitHub puede retrasarlo un rato si hay mucha carga.
- Si falla, GitHub te avisa por correo (si hiciste el punto 6).

### 13.4 Descargar y descifrar un backup

1. **Descarga el artifact.**
   - **Pulsa:** en la ejecución › **Artifacts** › `fichaje-backup-<fecha>`. Se descarga un `.zip`.
   - Descomprímelo: dentro está `fichaje-backup-<fecha>.json.gpg`.
2. **Descífralo fuera de la carpeta del proyecto** (por ejemplo, en Descargas), para que el JSON con datos personales no acabe nunca en Git. En Git Bash:
   ```bash
   cd ~/Downloads
   gpg --pinentry-mode loopback --decrypt --output fichaje-backup.json fichaje-backup-<fecha>.json.gpg
   ```
   Te pedirá la frase de paso (`BACKUP_PASSPHRASE`).
   - Por si acaso, `.gitignore` excluye `fichaje-backup*.json`, las exportaciones `fichaje-*.csv` / `fichaje-*.json` y las claves de cuentas de servicio, pero no lo uses como excusa: fuera del proyecto es más seguro.
3. **Comprueba:** `fichaje-backup.json` se abre y contiene `"format": "fichaje-practicas-backup"` y los contadores (`counts`).

Guarda la copia **cifrada** (`.gpg`) donde quieras, por ejemplo en OneDrive: sin la frase de paso no se puede leer.
- El JSON descifrado contiene datos personales: bórralo cuando termines de consultarlo.
- Guarda la frase de paso **solo** en el gestor de contraseñas.

### 13.5 Restaurar (resumen, por si algún día hiciera falta)

El JSON tiene esta estructura:
- `collections.users`
- `collections.sessions` (cada sesión con sus `revisions`)
- `collections.live`
- `collections.comments`
- `collections.meta`

Las fechas van como `{ "__type": "timestamp", "iso", "seconds", "nanoseconds" }`.

Las reglas impiden reescribir sesiones desde la app. Para restaurar hay que escribir con permisos de administración:

1. **Descifra el backup** (13.4).
2. **Genera una clave de administración temporal.**
   - **Pulsa:** **Configuración del proyecto › Cuentas de servicio** (*Service accounts*) › **Generar nueva clave privada**.
   - Guárdala en la **misma carpeta de fuera del proyecto** que el JSON descifrado (por ejemplo, `~/Downloads/restauracion/`), nunca dentro del repositorio.
3. **Escribe un script pequeño** con `firebase-admin`, que ya está en las dependencias de desarrollo (puedes guardarlo en la carpeta del proyecto, pero que lea la clave y el JSON con su **ruta absoluta** de fuera).
   - Debe convertir cada `{"__type": "timestamp"}` en `new Timestamp(seconds, nanoseconds)`.
   - Debe escribir cada documento con **su mismo ID**: sesiones y sus `revisions`, comentarios, `live`, `meta` y, si faltan, los `users`.
4. **Pruébalo primero contra los emuladores**, sin la clave real:
   - Arranca `npm run emulators`.
   - En el script, para la prueba, inicializa con `initializeApp({ projectId: 'demo-fichaje' })` (sin credenciales) y ejecútalo con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8181`. Con un proyecto `demo-` es imposible escribir en producción por error.
   - Comprueba el resultado en la interfaz del emulador (http://127.0.0.1:4000) o con `npm run dev:emu`. Si inicializas con la clave real, los datos irían a otro proyecto dentro del emulador y no los verías.
   - Para la restauración definitiva: `unset FIRESTORE_EMULATOR_HOST`, inicializa con la clave real y ejecútalo contra el proyecto.
5. **Borra la clave de administración:**
   - en Google Cloud › IAM › Cuentas de servicio › Claves;
   - y el fichero descargado.

Las cuentas de Authentication **no** están en el backup: solo están sus UID dentro de `users`.
- Si hubiera que recrear el proyecto, crea las cuentas de nuevo.
- Después sustituye los UID antiguos por los nuevos en `owner`, `session_owner`, `author_uid` y en los IDs de `users` y `live`.

Para consultar las horas, normalmente basta con el CSV mensual (paso 14).

### 13.6 Backup a mano desde tu ordenador (opcional)

Lo normal es lanzar el workflow (13.3). Si alguna vez necesitas una copia desde tu ordenador contra el proyecto real:

1. En Git Bash, en la carpeta del proyecto, carga las variables sin que la contraseña quede en el historial:
   ```bash
   export FIREBASE_API_KEY=<clave de backup> FIREBASE_PROJECT_ID=<ID> BACKUP_EMAIL=<email +backup>
   read -rs BACKUP_PASSWORD && export BACKUP_PASSWORD
   npm run backup
   unset BACKUP_PASSWORD
   ```
   `read -rs` espera a que pegues la contraseña (no se ve) y pulses Enter.
2. Ten en cuenta que:
   - la copia queda **sin cifrar** en `backups/` (Git la ignora): cífrala con `gpg --symmetric` o bórrala cuando termines;
   - actualiza el indicador de backup de la app, así que puede ocultar que el workflow semanal está fallando: revisa también **Actions**.

## 14. Rutina

**Cada mes** (por ejemplo, el día 1):
- **Exporta los datos.**
  - **Pulsa:** menú de la cabecera › **Exportar CSV (Excel)**, y también **Exportar JSON completo**.
  - Guarda los dos ficheros en tu carpeta de OneDrive.
- **Pide a tu profesora** que exporte también su CSV.

**Cada semana:**
- Mira el **indicador de backup** de la app (solo se actualiza cuando la copia cifrada se ha subido).
- Si avisa de que el último backup tiene más de 10 días, entra en **Actions** y revisa qué ha pasado.
- Si GitHub hubiera desactivado el workflow, **pulsa** **Actions › Backup semanal › Enable workflow**.

**Correos:**
- Lee los correos de Firebase y Google Cloud que lleguen a la cuenta propietaria: cambios de condiciones, avisos de cuota, seguridad.
- Crea un filtro para que no acaben en spam.
- Los correos de "He olvidado mi contraseña" salen de `noreply@<ID>.firebaseapp.com` y a veces llegan a spam.

**Cuotas:**
- El uso normal queda muy por debajo de los límites gratuitos: 50.000 lecturas y 20.000 escrituras al día.
- Puedes consultarlo en **Firestore › Uso** (*Usage*).
- Si la app muestra un aviso de cuota agotada, espera al reinicio diario (medianoche en California, hacia las 09:00 en Madrid).

**Al terminar las prácticas:**
1. **Guarda la exportación final.**
   - Exporta el CSV y el JSON finales, y compártelos con tu profesora si lo necesita.
   - Lanza el workflow a mano una última vez y descarga el artifact.
2. **Desactiva el backup.**
   - **Pulsa:** **Actions › Backup semanal › ··· › Disable workflow**.
3. **Decide qué hacer con el proyecto:**
   - **Conservarlo:** la app sigue disponible para consultas. Si ya no hace falta que tu profesora entre, deshabilita su cuenta en **Authentication › Usuarios › ⋮ › Inhabilitar cuenta**.
   - **Cerrarlo:**
     1. Asegúrate de tener las exportaciones.
     2. **Pulsa:** **Configuración del proyecto › General › Eliminar proyecto**. Google permite recuperarlo durante unos 30 días.
     3. Borra también los secrets del repositorio, o el repositorio entero.
     4. En la consola de Google Cloud, comprueba que no quedan claves de API ni claves de cuentas de servicio.

## 15. Solución de problemas

| Síntoma | Causa probable y solución |
|---|---|
| Pantalla "Falta la configuración de Firebase" | Falta `.env.local` o sus nombres no coinciden con `.env.example`. Corrígelo y reinicia `npm run dev`. Si pasa en la web publicada, vuelve a ejecutar `npm run deploy` con `.env.local` correcto |
| "Tu cuenta no tiene acceso" | No existe `users/<UID>`, el ID no coincide con el UID, o `role` está mal escrito. Otra posibilidad: aún no has desplegado las reglas (`npm run deploy:rules`). Si acabas de restringir la clave (paso 12), abre F12 y busca `are blocked`: revisa los sitios web (12.3) y las APIs (12.4) |
| En la consola del navegador (F12): `Requests to this API … are blocked` o `API_KEY_SERVICE_BLOCKED` | A la clave web le falta una de las tres APIs, o tiene marcadas otras en su lugar (paso 12.4). Corrígelo y espera 5 minutos |
| No puedo entrar: "Correo o contraseña incorrectos" | Usa "He olvidado mi contraseña" o cambia la contraseña en **Authentication › Usuarios › ⋮ › Restablecer contraseña** |
| En la consola del navegador (F12): `requests-from-referer-…-are-blocked` o errores de API key | Falta el dominio en la clave web (paso 12.3). Añádelo y espera 5 minutos |
| Una entrada manual se rechaza | Recuerda los límites: como mucho 31 días atrás, 16 h y nota de 5 caracteres; nada en el futuro ni antes de `program_start`. Comprueba que `program_start` es de tipo **timestamp** y tiene la fecha correcta |
| "Permiso denegado" al fichar | Reglas sin desplegar (`npm run deploy:rules`) o perfil mal creado (paso 6) |
| Aviso "Revisa el objetivo de horas de tu perfil", o la app usa 298 h aunque hayas puesto otro objetivo | `target_hours` no es de tipo **number** (por ejemplo, `"298"` como string) o no es mayor que 0: corrígelo en `users/<UID>` (paso 6) |
| `npm run deploy`: "No currently active project" | Ejecuta `npx firebase use --add` (paso 8.2) |
| `npm run deploy`: error de Firestore o de base de datos inexistente | Crea antes la base de datos (paso 3) |
| `npm run deploy`: "Failed to authenticate" | `npx firebase login --reauth` |
| `npm run deploy`: "Unable to deploy to Hosting as there is no Hosting site" | Ejecuta `npx firebase hosting:sites:create <ID>` (con el ID del proyecto) y repite `npm run deploy`. Lánzalo desde Git Bash para que pueda hacerte preguntas (paso 8.3) |
| Backup: "No se pudo iniciar sesión con la cuenta de backup" | Revisa los secrets `BACKUP_EMAIL` y `BACKUP_PASSWORD` |
| Backup: "La API key rechaza la petición" | La clave de backup tiene restricción de sitios web o le falta alguna de las tres APIs (paso 12.6) |
| Backup: "La API key no es válida" | El secret `FIREBASE_API_KEY_BACKUP` está mal copiado |
| Backup: "Permiso denegado en Firestore" | Falta `users/<UID de backup>` con `role` = `backup`, las reglas no están desplegadas o `FIREBASE_PROJECT_ID` no es el proyecto de la clave |
| Backup: "No se encuentra la base de datos" o "Firestore no acepta la sesión" | El secret `FIREBASE_PROJECT_ID` es incorrecto |
| Backup: "Falta el secret BACKUP_PASSPHRASE" | Créalo (paso 13.2). El workflow lo comprueba en su primer paso, antes de leer nada |
| Backup: falla "Marcar la copia en la app" | La copia cifrada sí está subida (compruébalo en **Artifacts**), pero el indicador no se ha actualizado: suele ser la cuota diaria o un fallo puntual. Vuelve a lanzar el workflow |
| Backup: falla `npm ci` | `package-lock.json` no coincide con `package.json`. Ejecuta `npm install` en tu ordenador, haz commit del `package-lock.json` y súbelo |
| El indicador de backup no se actualiza | Mira si la última ejecución del workflow está en verde: el indicador solo cambia si llega al último paso. Si GitHub desactivó el workflow, actívalo (paso 14) |
| `gpg: decryption failed: Bad session key` | La frase de paso no es la correcta |
| `npm run emulators`: "Could not spawn java" o error de versión | Instala Java 21 y ponlo en el PATH (`java -version`) |
| `npm run emulators`: puerto ocupado | Otro programa usa el 8181, el 9099 o el 4000. Ciérralo, o cierra una ejecución anterior de los emuladores |
| `npm run test:rules`: puerto 8181 ocupado | Para antes `npm run emulators` (Ctrl+C): los tests arrancan su propio emulador |
| `npm run seed`: "No se puede conectar con el emulador" | Arranca antes `npm run emulators` en otra terminal |
| No llega el correo de restablecimiento | Mira en spam. Comprueba el idioma y el remitente en **Authentication › Plantillas** |
| En el iPhone no aparece "Añadir a pantalla de inicio" | Abre la URL en **Safari** |
| Al pulsar EMPEZAR: "queda el cerrojo live/… de una sesión que ya no existe" | Cerrojo huérfano: existe `live/<UID>` pero la sesión a la que apunta se borró desde la consola. Las reglas no dejan a la app borrar ese cerrojo. **Pulsa:** **Firestore › Datos › live ›** documento con tu UID **› ⋮ › Eliminar documento**. No borres nunca sesiones desde la consola |
| Una nota o un motivo con emojis se rechaza por largo | Para los límites de 2000 y 500 caracteres, cada emoji cuenta como 2 (igual que el contador del campo) |
| `npm run test:integration`: puertos ocupados | Para antes `npm run emulators` (Ctrl+C): los tests arrancan sus propios emuladores de Auth y Firestore |
| Olvidé parar una sesión | En la tarjeta de fichaje, usa "Terminé antes / olvidé parar" e indica la hora real y el motivo. Pasadas 16 h, la app lo pide directamente |
| Al parar o al añadir horas: "El servidor ha rechazado la hora…" o "…ha rechazado la entrada" | Casi siempre es el reloj del móvil o del ordenador, que no está en hora: ponlo en hora automática y repite. Si la sesión ya supera las 16 h, usa "Terminé antes / olvidé parar" |
| "La sesión ya se había parado desde otro dispositivo" | Se paró desde otro móvil u ordenador mientras este guardaba. Revisa la sesión en el historial: si la hora no es la buena, anúlala y añade una entrada manual; si falta la nota, usa "Editar nota" |
| Aviso "Una nota no llegó a guardarse" | La sesión se paró (en otro dispositivo) sin la nota que habías escrito en este. Copia el texto del aviso, abre la sesión en el historial y pégalo con "Editar nota". Después pulsa **Descartar** |
| "No se puede conectar con el servidor" al abrir la app | Sin conexión, o la red bloquea Firebase. La app lo reintenta sola; comprueba la conexión o pulsa **Reintentar** |
| Alguien ha entrado con tu cuenta o la de tu profesora (miles de entradas o comentarios, cuota agotada) | 1. **Authentication › Usuarios › ⋮ › Inhabilitar cuenta** en la cuenta afectada y, después, **Restablecer contraseña**. 2. Los datos basura no se pueden borrar desde la app: bórralos en **Firestore › Datos** (o con un script de `firebase-admin` como el de 13.5) o restaura el último backup bueno (13.5). 3. Si se agotó la cuota, espera al reinicio diario. 4. Vuelve a habilitar la cuenta con la contraseña nueva |
| Me equivoqué en una entrada manual | Las horas no se editan: anúlala con un motivo y créala de nuevo con los datos correctos |
