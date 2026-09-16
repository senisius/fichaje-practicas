# Recomendación final: app de fichaje de prácticas (298 h)

## 1. Stack elegido

| Capa | Elección |
|---|---|
| **Frontend** | Página única (SPA) con **Vite 8.3.0, React 19.3.0 y TypeScript**. Datos con el SDK modular **firebase 12.19.0**. **date-fns-tz 3.2.0** (con date-fns 4.4.0) convierte la hora de Madrid a UTC. No hay router: la vista se elige según el rol. Para desarrollar: firebase-tools 15.30.1 (necesita Node 20 o superior), el emulador de Firebase (necesita Java), @firebase/rules-unit-testing 5.0.2 y vitest 5.0.1. Versiones comprobadas con `npm view` el 2026-09-16. |
| **Backend y login** | **Firebase, plan Spark** (sin tarjeta). Login con email y contraseña (Firebase Authentication). Base de datos **Cloud Firestore Standard** `(default)`, creada en **modo producción** en `europe-southwest1` (Madrid). Toda la autorización y las reglas de integridad van en `firestore.rules`. No hay Cloud Functions. |
| **Hosting** | **Firebase Hosting clásico** en `https://<proyecto>.web.app`. `npm run build && firebase deploy` publica a la vez la web y las reglas. |

**Por qué frente a Next.js + Supabase + Vercel.**
- **Qué se mantiene de tu propuesta:** un backend gestionado que impone los permisos, y el modelo `users / sessions / comments`. `status` y `duration_minutes` ya no se guardan: se calculan a partir de las horas de inicio y fin.
- **Qué cambia:** las tres piezas.
  - **Supabase → Firebase.** Supabase Free pausa el proyecto tras una semana con poca actividad. Además, su correo por defecto no puede enviar nada a la profesora. La documentación de Spark no menciona pausas y el correo de "he olvidado mi contraseña" llega a cualquier dirección. Así te ahorras el cron para mantenerlo activo y el servidor de correo propio.
  - **Next.js con SSR → SPA.** Con dos usuarias, el renderizado en servidor no añade seguridad: los permisos los imponen igualmente las reglas del backend. En cambio, añade proxy, cookies y `@supabase/ssr`, que sigue en beta.
  - **Vercel → Firebase Hosting.** Todo queda en un solo proveedor y se evita la cláusula de "uso no comercial" de Vercel Hobby.
- **Si prefieres SQL:** la variante Supabase, ya corregida, está en §3.B y §4.B.

---

## 2. Riesgos del plan gratuito y mitigación

Estados: **[V]** verificado en una fuente oficial actual · **[P]** probable · **[NV]** no verificado.

| Riesgo | Dato y fuente | Mitigación |
|---|---|---|
| Que Spark cambie sus condiciones o empiece a pausar proyectos | La documentación de planes no menciona pausas ni borrados por inactividad en Spark ([firebase-pricing-plans](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans)) **[V]**. Es una ausencia en la documentación, **no una garantía contractual**. | Plan B en §3.B/§4.B: la SPA no cambia, solo se reescribe la capa de datos (`src/data/*`). Leer los correos de Firebase. |
| No hay backups | Backups y restauración a un momento anterior (PITR) quedan fuera de la cuota gratuita ([firestore/pricing](https://firebase.google.com/docs/firestore/pricing)) **[V]**. La exportación gestionada solo existe en el plan de pago Blaze (dato de la propuesta 3) **[P]**. | Ninguna regla permite borrar desde la app. Backup semanal automático con una cuenta `backup` de solo lectura (§5.7). La app muestra la fecha del último backup. Botón "Exportar CSV/JSON" una vez al mes a OneDrive; la profesora también lo usa. |
| Cuotas diarias con corte duro | 50.000 lecturas, 20.000 escrituras y 20.000 borrados al día; 50.000 usuarios activos al mes; Hosting con 10 GB y 360 MB/día ([pricing](https://firebase.google.com/pricing)) **[V]**. Si se superan, el servicio se corta hasta el siguiente periodo **[V]**. El reinicio es hacia medianoche del Pacífico, unas 09:00 en Madrid **[NV]**. Una carga completa de la app son unas 200–400 lecturas. | Suscribirse a los datos en un único hook raíz, que se activa al entrar y se limpia al salir. Desarrollar contra el emulador. Mostrar un aviso claro si llega el error `resource-exhausted`. |
| Las reglas son la única barrera | La configuración web de Firebase es pública. Una base de datos en "modo prueba" queda abierta a cualquiera y deja de funcionar a los 30 días (dato de las propuestas). | Base de datos en modo producción. Reglas versionadas en el repo. Los 12 tests de §4 en el emulador antes de cada despliegue de reglas. |
| Registro público abierto | Para desactivar "Enable create (sign-up)" hay que pasar a Identity Platform. En Spark parece posible con un tope de 3.000 usuarios activos al día **[P]** (sin fuente oficial en esta investigación). | Hacer ese cambio y desmarcar *create* y *delete*. Aunque no se haga, una cuenta sin documento `users/{uid}` no puede hacer nada. La app no tiene pantalla de registro. |
| Correos de login | Remitente `noreply@<proyecto>.firebaseapp.com`. Cuotas en Spark: 150 correos de restablecimiento al día y 5 enlaces mágicos **[NV]** (dato de la propuesta 3). | Usar solo "he olvidado mi contraseña", nunca enlaces mágicos. Avisar a la profesora de que mire en spam. Darle la contraseña inicial en persona. |
| Límite de lecturas dentro de las reglas | Máximo 10 lecturas get/exists por operación y 20 por transacción (dato de la propuesta 3, que dice haberlo comprobado). | El diseño usa como mucho 4 por operación y 7 por transacción. Recontar si se amplían las reglas. |
| La propietaria del proyecto puede editar datos desde la consola de Firebase | Pasa lo mismo con cualquier backend gestionado (en Supabase, desde el Dashboard). | Las horas las pone el servidor. Cada cambio hecho desde la app deja una copia del estado anterior en `revisions`. La profesora guarda su CSV mensual, así que cualquier cambio posterior se notaría. **No añadir a la profesora como miembro del proyecto.** |
| Solo una base de datos gratuita y ubicación fija | Solo hay una base de datos gratuita por proyecto **[V]**, y su ubicación no se puede cambiar después. | Elegir `europe-southwest1` al crearla. |
| Cuenta propietaria | Una cuenta de Google Workspace de la UAB puede tener restricciones o desaparecer al acabar los estudios. | Usar una cuenta de Google personal con verificación en dos pasos. |
| Las versiones de Hosting se acumulan | El límite es de 10 GB **[V]**. | Conservar solo unas 5 versiones (ajuste de retención en la consola). |
| El workflow de backup deja de ejecutarse | En repos públicos, los workflows programados se desactivan tras 60 días sin actividad ([docs.github.com](https://docs.github.com/en/actions/writing-workflows/choosing-when-your-workflow-runs/events-that-trigger-workflows)) **[V]**. Para repos privados no está documentado **[NV]**. | Usar un repo privado. La app avisa si el último backup tiene más de 10 días. El workflow también se puede lanzar a mano (`workflow_dispatch`). |

**Por qué Supabase no es la opción principal:**
- Pausa los proyectos Free tras 1 semana con poca actividad **[V]**. Se pueden restaurar durante 1 año; la cifra de 90 días que aparece en algunas fuentes está desfasada **[V]**.
- Su SMTP por defecto solo envía a miembros del equipo del proyecto y como mucho 2 correos por hora **[V]**.
- El plan Free no tiene backups **[V]**.
- Las tablas nuevas necesitan GRANT explícitos **[V]**.
- Los proyectos creados desde el 1-11-2025 ya no tienen las claves legacy `anon`/`service_role` **[P]**.

Descartes: Appwrite Cloud pausa tras 7 días sin actividad en la consola (el uso de la app no cuenta) y borra el proyecto si sigue pausado 90 días **[V]**. Vercel Hobby es solo para uso personal no comercial **[V]**.

---

## 3. Esquema de datos

### 3.A Firestore (recomendado)

```text
users/{uid}          // Se crea A MANO en la consola. La app nunca escribe aquí.
  role            'student' | 'supervisor' | 'backup'
  name            string
  email           string (informativo)
  target_hours    number     // solo en el documento del student: 298
  program_start   timestamp  // solo en el documento del student: inicio real de las prácticas

sessions/{sid}       // id generado en el cliente
  owner           string     uid del student; no cambia nunca
  method          'live' | 'manual'; no cambia nunca
  start_time      timestamp  live: hora del servidor; manual: hora de Madrid pasada a UTC
  end_time        timestamp | null     null = en curso
  adjusted        bool       true si el fin de una sesión live se tecleó a mano
  adjust_reason   string     '' o motivo de al menos 10 caracteres
  voided          bool       anulación: solo puede pasar de false a true
  void_reason     string     '' o motivo de al menos 10 caracteres
  note            string     hasta 2000 caracteres; en las manuales, al menos 5
  rev             int        empieza en 0 y sube 1 en cada cambio
  created_at      timestamp  hora del servidor
  updated_at      timestamp  hora del servidor
  // Valores derivados, NO se guardan:
  //   status   = voided ? 'anulada' : end_time == null ? 'en_curso' : 'cerrada'
  //   duración = end_time - start_time   (en ms; los cambios de hora no la alteran)

sessions/{sid}/revisions/{rev}   // Historial append-only: estado ANTERIOR a cada cambio.
  before          map        copia exacta de la sesión antes del cambio
  at              timestamp  hora del servidor

live/{uid}           // Cerrojo: existe solo mientras ese student tiene una sesión abierta.
  session_id      string     // sustituye al índice único parcial de SQL

comments/{cid}       // Solo la supervisora los crea; nunca se editan ni se borran.
  session_id      string
  session_owner   string     igual a sessions.owner (lo comprueban las reglas)
  author_uid      string     uid de la supervisora
  text            string     1–2000 caracteres
  created_at      timestamp  hora del servidor

meta/backup          // Solo lo escribe la cuenta 'backup'.
  last_backup_at  timestamp  hora del servidor
  docs            int

Índices compuestos: ninguno (firestore.indexes.json vacío). Todas las consultas
filtran por una sola igualdad o no filtran; el orden se aplica en el cliente.
  student:     sessions where owner == uid;  live/{uid};  comments where session_owner == uid;  users
  supervisora: sessions;  live;  comments;  users;  revisions de una sesión al abrir su detalle
Volumen esperado: unas 75–150 sesiones en total, menos de 1 MB.
```

`firebase.json`:
```json
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "emulators": { "auth": { "port": 9099 }, "firestore": { "port": 8080 } }
}
```

Tipos y función de progreso (TypeScript válido; se calcula en el cliente con las sesiones que ya están cargadas, sin lecturas extra):
```ts
import type { Timestamp } from 'firebase/firestore';
export type Role = 'student' | 'supervisor' | 'backup';
export interface UserDoc { role: Role; name: string; email?: string; target_hours?: number; program_start?: Timestamp }
export interface SessionDoc {
  owner: string; method: 'live' | 'manual';
  start_time: Timestamp; end_time: Timestamp | null;
  adjusted: boolean; adjust_reason: string;
  voided: boolean; void_reason: string;
  note: string; rev: number; created_at: Timestamp; updated_at: Timestamp;
}
export interface LiveDoc { session_id: string }
export interface CommentDoc { session_id: string; session_owner: string; author_uid: string; text: string; created_at: Timestamp }

const H = 3_600_000;
const dur = (s: SessionDoc) => s.end_time!.toMillis() - s.start_time.toMillis();
const total = (xs: SessionDoc[]) => xs.reduce((a, s) => a + dur(s), 0);

export function progress(sessions: SessionDoc[], targetHours: number, open: SessionDoc | null, skewMs = 0) {
  const valid = sessions.filter(s => s.end_time !== null && !s.voided);   // ni anuladas ni en curso
  const doneMs = total(valid);                                            // enteros en ms: sin error acumulado
  const goalMs = targetHours * H;
  return {
    doneMs,
    liveMs: open ? Math.max(0, Date.now() + skewMs - open.start_time.toMillis()) : 0, // provisional, se muestra aparte
    pct: Math.min(100, (doneMs / goalMs) * 100),
    remainingMs: Math.max(0, goalMs - doneMs),
    manualMs: total(valid.filter(s => s.method === 'manual')),
    liveMethodMs: total(valid.filter(s => s.method === 'live')),
    adjustedCount: valid.filter(s => s.adjusted).length,
  };
}
```

Cómo se muestra:
- **Formato:** `Math.floor(ms / H)` h y `Math.floor(ms / 60000) % 60` min; porcentaje con 1 decimal.
- **Días y semanas:** cada sesión cuenta en la fecha local de su `start_time`, obtenida con `Intl.DateTimeFormat('en-CA', {timeZone: 'Europe/Madrid'})` (formato `YYYY-MM-DD`). Las semanas son ISO, de lunes a domingo.
- **Fecha estimada de fin:** ritmo = horas de las últimas 4 semanas / 4. Si el ritmo es mayor que 0, fin = hoy + restante / ritmo; si no, se muestra "sin ritmo reciente".

### 3.B Variante SQL (Plan B, si eliges Supabase)

Ya incluye todas las correcciones de los jueces. En los proyectos nuevos, el SQL Editor no activa RLS en las tablas creadas por SQL; por eso se activa explícitamente en §4.B.

```sql
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;                 -- NO añadirlo a "Exposed schemas"
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Configuración (una sola fila)
create table public.settings (
  id                   boolean primary key default true check (id),
  target_hours         int  not null default 298 check (target_hours > 0),
  program_start        date not null,
  max_daily_minutes    int  not null default 720 check (max_daily_minutes between 60 and 960),
  manual_backdate_days int  not null default 31  check (manual_backdate_days between 0 and 366)
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete restrict,
  full_name  text not null check (char_length(full_name) between 1 and 120),
  role       text not null check (role in ('student','supervisor')),
  created_at timestamptz not null default now()
);
create unique index profiles_single_student on public.profiles (role) where role = 'student';

create table public.sessions (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete restrict,
  method         text not null check (method in ('live','manual')),
  started_at     timestamptz,                -- live: now() del servidor; manual: null
  ended_at       timestamptz,                -- live: now() del servidor o corregida con motivo
  end_source     text check (end_source in ('server','corrected')),
  manual_minutes int,
  work_date      date not null,              -- fecha civil en Europe/Madrid
  note           text not null default '' check (char_length(note) <= 2000),
  voided_at      timestamptz,
  void_reason    text,
  revision       int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- En segundos (corrige la pérdida de hasta 59 s por sesión que causaba el floor en minutos)
  duration_s     int generated always as (
    case when method = 'manual' then manual_minutes * 60
         when ended_at is not null then floor(date_part('epoch', ended_at - started_at))::int
    end) stored,
  status         text generated always as (
    case when voided_at is not null then 'anulada'
         when method = 'live' and ended_at is null then 'en_curso'
         else 'cerrada' end) stored,
  constraint live_shape   check (method <> 'live' or (started_at is not null and manual_minutes is null)),
  constraint live_end     check (ended_at is null or (ended_at > started_at
                                  and ended_at - started_at <= interval '16 hours')),
  constraint end_src      check ((ended_at is null) = (end_source is null)),
  -- CORREGIDO: 'is not null' explícito (NULL BETWEEN ... hacía pasar el CHECK)
  constraint manual_shape check (method <> 'manual' or (manual_minutes is not null
                                  and manual_minutes between 1 and 960
                                  and started_at is null and ended_at is null)),
  constraint void_shape   check ((voided_at is null) = (void_reason is null)
                                 and (void_reason is null or char_length(void_reason) >= 10)),
  constraint no_overlap exclude using gist (
    user_id with =, tstzrange(started_at, coalesce(ended_at, 'infinity'::timestamptz)) with &&
  ) where (method = 'live' and voided_at is null)
);
create unique index sessions_one_open_per_user on public.sessions (user_id)
  where method = 'live' and ended_at is null and voided_at is null;
create index sessions_user_date on public.sessions (user_id, work_date desc);

create table public.session_comments (                      -- append-only
  id         bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete restrict,
  author_id  uuid not null default auth.uid() references public.profiles(id),
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);
create index session_comments_session on public.session_comments (session_id, created_at);

create table public.session_audit (                         -- append-only
  id         bigint generated always as identity primary key,
  session_id bigint not null references public.sessions(id) on delete restrict,
  actor_id   uuid,                                -- null = cambio hecho fuera de la app
  action     text not null,                       -- clock_in|clock_out|close_corrected|manual_add|note_edit|void|direct_sql
  reason     text,
  old_row    jsonb,
  new_row    jsonb not null,
  via        text not null default session_user,  -- 'authenticator' = vía API
  at         timestamptz not null default now()
);
create index session_audit_session on public.session_audit (session_id, at);

create table public.ops_heartbeat (id boolean primary key default true check (id),
                                   beat_at timestamptz not null default now());
insert into public.ops_heartbeat default values;

-- ---------- Helpers y triggers (esquema private) ----------
create function private.deny() returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'Operación % no permitida en %', tg_op, tg_table_name using errcode = '42501'; end $$;

create function private.app_role() returns text
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = (select auth.uid())
$$;

create function private.require_student() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v uuid := auth.uid();
begin
  if v is null or private.app_role() is distinct from 'student' then
    raise exception 'Solo la estudiante puede registrar horas' using errcode = '42501';
  end if;
  return v;
end $$;

-- Horas inmutables: solo se puede fijar ended_at una vez, editar la nota o anular
create function private.sessions_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now(); new.updated_at := now(); new.revision := 1; return new;
  end if;
  if old.voided_at is not null then
    raise exception 'Sesión anulada: no editable' using errcode = '42501';
  end if;
  if new.user_id <> old.user_id or new.method <> old.method
     or new.started_at is distinct from old.started_at
     or new.work_date <> old.work_date
     or new.manual_minutes is distinct from old.manual_minutes
     or new.created_at <> old.created_at
     or (old.ended_at is not null and (new.ended_at is distinct from old.ended_at
                                       or new.end_source is distinct from old.end_source)) then
    raise exception 'Campo inmutable' using errcode = '42501';
  end if;
  new.updated_at := now(); new.revision := old.revision + 1; return new;
end $$;
create trigger sessions_guard before insert or update on public.sessions
  for each row execute function private.sessions_guard();
create trigger sessions_no_delete before delete or truncate on public.sessions
  for each statement execute function private.deny();

create function private.sessions_audit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.session_audit (session_id, actor_id, action, reason, old_row, new_row)
  values (new.id, auth.uid(),
          coalesce(nullif(current_setting('app.action', true), ''), 'direct_sql'),
          nullif(current_setting('app.reason', true), ''),
          case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return null;
end $$;
create trigger sessions_audit after insert or update on public.sessions
  for each row execute function private.sessions_audit();
create trigger audit_append_only before update or delete or truncate on public.session_audit
  for each statement execute function private.deny();
create trigger comments_append_only before update or delete or truncate on public.session_comments
  for each statement execute function private.deny();

-- Tope diario: solo bloquea las entradas manuales, pero suma también las horas live cerradas ese día.
-- (CORREGIDO: ya no se afirma que bloquee las live; esas las mide el servidor y tienen tope de 16 h.)
create function private.assert_daily_cap(p_uid uuid, p_date date, p_add_s int) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v bigint; cap int;
begin
  select s.max_daily_minutes * 60 into cap from public.settings s;
  select coalesce(sum(x.duration_s), 0) into v from public.sessions x
   where x.user_id = p_uid and x.work_date = p_date and x.voided_at is null;
  if v + p_add_s > cap then
    raise exception 'Superarías el máximo diario (% min); ya hay % min', cap / 60, v / 60 using errcode = 'P0001';
  end if;
end $$;

-- ---------- Operaciones (SECURITY DEFINER en private) ----------
create function private.clock_in(p_note text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student(); r public.sessions;
begin
  perform set_config('app.action', 'clock_in', true);
  insert into public.sessions (user_id, method, started_at, work_date, note)
  values (v_uid, 'live', now(), (now() at time zone 'Europe/Madrid')::date, coalesce(btrim(p_note), ''))
  returning * into r;
  return r;
exception when unique_violation or exclusion_violation then
  raise exception 'Ya tienes una sesión en curso' using errcode = 'P0001';
end $$;

create function private.clock_out(p_note text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student(); r public.sessions;
begin
  perform set_config('app.action', 'clock_out', true);
  update public.sessions s set ended_at = now(), end_source = 'server',
         note = coalesce(btrim(p_note), s.note)
   where s.user_id = v_uid and s.method = 'live' and s.ended_at is null and s.voided_at is null
  returning * into r;
  if not found then raise exception 'No hay ninguna sesión en curso' using errcode = 'P0001'; end if;
  return r;
exception when check_violation then
  raise exception 'La sesión supera 16 h: ciérrala con la hora real y un motivo' using errcode = 'P0001';
end $$;

-- CORREGIDO: el límite de 16 h va en el WHERE, así que ya no sale un error de constraint en crudo
create function private.close_forgotten(p_end timestamptz, p_reason text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student(); r public.sessions;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Motivo obligatorio (mín. 10 caracteres)' using errcode = 'P0001';
  end if;
  perform set_config('app.action', 'close_corrected', true);
  perform set_config('app.reason', btrim(p_reason), true);
  update public.sessions s set ended_at = p_end, end_source = 'corrected'
   where s.user_id = v_uid and s.method = 'live' and s.ended_at is null and s.voided_at is null
     and p_end > s.started_at and p_end < now()
     and p_end - s.started_at <= interval '16 hours'
  returning * into r;
  if not found then
    raise exception 'Hora no válida (entre el inicio y ahora, máx. 16 h) o no hay sesión abierta'
      using errcode = 'P0001';
  end if;
  return r;
end $$;

-- CORREGIDO: comprueba que p_minutes no sea null
create function private.add_manual(p_work_date date, p_minutes int, p_note text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student();
        st public.settings;
        v_today date := (now() at time zone 'Europe/Madrid')::date;
        r public.sessions;
begin
  select * into strict st from public.settings;
  if p_minutes is null or p_minutes not between 1 and 960 then
    raise exception 'Duración entre 1 min y 16 h' using errcode = 'P0001';
  end if;
  if p_work_date is null or p_work_date > v_today
     or p_work_date < greatest(st.program_start, v_today - st.manual_backdate_days) then
    raise exception 'Fecha fuera del rango permitido' using errcode = 'P0001';
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Describe la tarea (mín. 5 caracteres)' using errcode = 'P0001';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));
  perform private.assert_daily_cap(v_uid, p_work_date, p_minutes * 60);
  perform set_config('app.action', 'manual_add', true);
  insert into public.sessions (user_id, method, work_date, manual_minutes, note)
  values (v_uid, 'manual', p_work_date, p_minutes, btrim(p_note))
  returning * into r;
  return r;
end $$;
-- edit_manual se ha ELIMINADO: las horas no se editan; para corregir se anula y se crea otra.

create function private.edit_note(p_id bigint, p_note text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student(); r public.sessions;
begin
  perform set_config('app.action', 'note_edit', true);
  update public.sessions s set note = btrim(coalesce(p_note, ''))
   where s.id = p_id and s.user_id = v_uid and s.voided_at is null
     and (s.method = 'live' or char_length(btrim(coalesce(p_note, ''))) >= 5)
  returning * into r;
  if not found then raise exception 'Sesión no editable (o nota < 5 caracteres en una manual)' using errcode = 'P0001'; end if;
  return r;
end $$;

create function private.void_session(p_id bigint, p_reason text) returns public.sessions
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := private.require_student(); r public.sessions;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Motivo obligatorio (mín. 10 caracteres)' using errcode = 'P0001';
  end if;
  perform set_config('app.action', 'void', true);
  perform set_config('app.reason', btrim(p_reason), true);
  update public.sessions s set voided_at = now(), void_reason = btrim(p_reason)
   where s.id = p_id and s.user_id = v_uid and s.voided_at is null and s.status = 'cerrada'
  returning * into r;
  if not found then raise exception 'Solo se anulan sesiones propias cerradas y no anuladas' using errcode = 'P0001'; end if;
  return r;
end $$;

-- ---------- API pública (wrappers SECURITY INVOKER) ----------
create function public.clock_in(p_note text default null) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.clock_in(p_note) $$;
create function public.clock_out(p_note text default null) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.clock_out(p_note) $$;
create function public.close_forgotten(p_end timestamptz, p_reason text) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.close_forgotten(p_end, p_reason) $$;
create function public.add_manual(p_work_date date, p_minutes int, p_note text) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.add_manual(p_work_date, p_minutes, p_note) $$;
create function public.edit_note(p_id bigint, p_note text) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.edit_note(p_id, p_note) $$;
create function public.void_session(p_id bigint, p_reason text) returns public.sessions
  language sql security invoker set search_path = '' as $$ select * from private.void_session(p_id, p_reason) $$;
create function public.server_now() returns timestamptz
  language sql stable security invoker set search_path = '' as $$ select now() $$;
-- Keep-alive: se llama con la publishable key (rol anon) y solo toca beat_at
create function public.heartbeat() returns timestamptz
  language sql security invoker set search_path = '' as $$
  update public.ops_heartbeat set beat_at = now() where id returning beat_at $$;

-- ---------- Vistas (security_invoker: respetan RLS) ----------
create view public.v_sessions with (security_invoker = true) as
select s.*,
       s.started_at at time zone 'Europe/Madrid' as started_local,
       s.ended_at   at time zone 'Europe/Madrid' as ended_local,
       exists (select 1 from public.session_audit a where a.session_id = s.id
                 and a.action in ('note_edit','close_corrected','void')) as edited,
       exists (select 1 from public.session_audit a where a.session_id = s.id
                 and a.action = 'direct_sql') as touched_outside_app,
       (select count(*) from public.session_comments c where c.session_id = s.id) as comment_count
from public.sessions s;

-- CORREGIDO: suma en segundos y porcentaje en numeric (antes era división entera)
create view public.v_progress with (security_invoker = true) as
select p.id as user_id,
       st.target_hours,
       coalesce(sum(s.duration_s) filter (where s.status = 'cerrada'), 0)                         as done_s,
       coalesce(sum(s.duration_s) filter (where s.status = 'cerrada' and s.method = 'live'), 0)   as live_s,
       coalesce(sum(s.duration_s) filter (where s.status = 'cerrada' and s.method = 'manual'), 0) as manual_s,
       least(100, round(100.0 * coalesce(sum(s.duration_s) filter (where s.status = 'cerrada'), 0)
                        / (st.target_hours * 3600), 1))                                          as pct,
       greatest(0, st.target_hours * 3600
                   - coalesce(sum(s.duration_s) filter (where s.status = 'cerrada'), 0))         as remaining_s,
       max(s.started_at) filter (where s.status = 'en_curso')                                    as open_since
from public.profiles p
cross join public.settings st
left join public.sessions s on s.user_id = p.id
where p.role = 'student'
group by p.id, st.target_hours;

-- CORREGIDO: work_date::timestamp para que el resultado no dependa del TimeZone de la sesión
create view public.v_weekly with (security_invoker = true) as
select user_id,
       date_trunc('week', work_date::timestamp)::date as week_start,     -- lunes (ISO)
       sum(duration_s) filter (where status = 'cerrada') as seconds
from public.sessions
group by user_id, date_trunc('week', work_date::timestamp)::date;

-- ---------- Alta inicial (tras crear las 2 cuentas en Authentication > Users) ----------
insert into public.settings (program_start) values (date '2026-09-01');   -- AJUSTA a la fecha real
insert into public.profiles (id, full_name, role)
  select id, 'Nombre Estudiante', 'student'    from auth.users where email = '<email estudiante>';
insert into public.profiles (id, full_name, role)
  select id, 'Nombre Profesora',  'supervisor' from auth.users where email = '<email profesora>';
```

---

## 4. Permisos

### Matriz rol × colección × operación (Firebase)

| Colección | student | supervisor | backup (técnica) | sin perfil / anónimo |
|---|---|---|---|---|
| `users` | leer | leer | leer | nada |
| `sessions` | leer **las suyas**. Crear una live (hora del servidor) o una manual (con límites). Modificar solo para: parar, editar la nota, anular con motivo | leer todas | leer | nada |
| `sessions/*/revisions` | leer las suyas. Crear solo en el mismo commit que el cambio de la sesión | leer | leer | nada |
| `live` | leer, crear y borrar el suyo, siempre junto a su sesión | leer | leer | nada |
| `comments` | leer los de sus sesiones | leer; **crear** como autora | leer | nada |
| `meta/backup` | leer | leer | leer; escribir la marca de backup | nada |

**Nadie** puede borrar sesiones ni escribir en `users`. La supervisora no tiene ninguna forma de escribir en `sessions` ni en `live`. Los comentarios no se editan ni se borran.

### Asignación segura del rol
1. Crear el proyecto con una cuenta de Google **personal** con verificación en dos pasos, sin Analytics.
2. Crear Firestore Standard en modo **producción** en `europe-southwest1`. Desplegar `firestore.rules` antes de compartir la URL.
3. En Authentication, activar solo **Email/Password** (no el enlace sin contraseña).
4. Opcional pero recomendado: *Upgrade to Identity Platform* **[P]**. Después, en Settings > User actions, desmarcar **Enable create (sign-up)** y **Enable delete**.
5. En Authentication > Users > **Add user**, crear 3 cuentas: estudiante, profesora y `backup`. Copiar sus UID.
6. En la consola de Firestore, crear los documentos:
   - `users/<uid_est> = {role:'student', name, email, target_hours:298, program_start:<timestamp>}`
   - `users/<uid_prof> = {role:'supervisor', name, email}`
   - `users/<uid_backup> = {role:'backup', name:'backup'}`
7. Como las reglas tienen `allow write: if false` en `users`, nadie puede cambiarse el rol desde la app.
8. **No** añadir a la profesora como miembro del proyecto de Firebase o Google Cloud: tendría acceso a la consola.
9. Darle su contraseña inicial en persona; ella la cambia con "He olvidado mi contraseña".
10. Opcional: restringir la API key web por *referrer* a `<proyecto>.web.app/*`, `<proyecto>.firebaseapp.com/*` y `localhost`. El script de backup, que no envía referrer, necesita entonces **otra** API key restringida solo por API.

### `firestore.rules`

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ---------- helpers ----------
    function signedIn()        { return request.auth != null; }
    function uid()             { return request.auth.uid; }
    function userPath(u)       { return /databases/$(database)/documents/users/$(u); }
    function sessPath(id)      { return /databases/$(database)/documents/sessions/$(id); }
    function livePath(u)       { return /databases/$(database)/documents/live/$(u); }
    function revPath(sId, n)   { return /databases/$(database)/documents/sessions/$(sId)/revisions/$(string(n)); }
    // Si no existe users/{uid}, get() falla y la regla deniega (fail-closed)
    function profile()         { return get(userPath(uid())).data; }
    function isStudent()       { return signedIn() && profile().role == 'student'; }
    function isSupervisor()    { return signedIn() && profile().role == 'supervisor'; }
    function isBackup()        { return signedIn() && profile().role == 'backup'; }
    function isReader()        { return signedIn() && profile().role in ['supervisor', 'backup']; }
    function isAppUser()       { return signedIn() && profile().role in ['student', 'supervisor', 'backup']; }
    function hours(h)          { return duration.value(h, 'h'); }
    function strOk(s, lo, hi)  { return s is string && s.size() >= lo && s.size() <= hi; }
    function sessionKeys() {
      return ['owner','method','start_time','end_time','adjusted','adjust_reason',
              'voided','void_reason','note','rev','created_at','updated_at'];
    }

    match /users/{u} {
      allow read: if isAppUser();
      allow write: if false;                       // los roles solo se crean en la consola
    }

    match /sessions/{sid} {
      function n()       { return request.resource.data; }
      function o()       { return resource.data; }
      function changed() { return n().diff(o()).affectedKeys(); }

      allow read: if isReader() || (isStudent() && o().owner == uid());

      allow create: if isStudent()
        && n().keys().hasAll(sessionKeys()) && n().keys().hasOnly(sessionKeys())
        && n().owner == uid()
        && n().adjusted == false && n().adjust_reason == ''
        && n().voided == false && n().void_reason == ''
        && n().rev == 0
        && n().created_at == request.time && n().updated_at == request.time
        && (liveStart() || manualEntry());

      function liveStart() {
        return n().method == 'live'
          && n().start_time == request.time               // hora del servidor
          && n().end_time == null
          && strOk(n().note, 0, 2000)
          && !exists(livePath(uid()))                     // no había otra sesión abierta
          && getAfter(livePath(uid())).data.session_id == sid;
      }

      function manualEntry() {
        let s = n().start_time;
        let e = n().end_time;
        return n().method == 'manual'
          && s is timestamp && e is timestamp
          && e > s
          && e <= s + hours(16)
          && e <= request.time                            // nada en el futuro
          && s >= profile().program_start                 // CORREGIDO: límite inferior
          && s + hours(744) >= request.time               // CORREGIDO: máx. 31 días de retraso
          && strOk(n().note, 5, 2000);                    // tarea obligatoria
      }

      allow update: if isStudent() && o().owner == uid()
        && n().rev == o().rev + 1
        && n().updated_at == request.time
        && existsAfter(revPath(sid, o().rev))             // copia del estado anterior en el mismo commit
        && (stop() || noteOnly() || voidIt());

      function stop() {
        return o().end_time == null && o().voided == false
          && changed().hasOnly(['end_time','adjusted','adjust_reason','note','rev','updated_at'])
          && strOk(n().note, 0, 2000)
          && n().end_time is timestamp
          && n().end_time <= o().start_time + hours(16)
          && ( (n().adjusted == false && n().adjust_reason == '' && n().end_time == request.time)
            || (n().adjusted == true && strOk(n().adjust_reason, 10, 500)
                && n().end_time > o().start_time && n().end_time < request.time) )
          && !existsAfter(livePath(uid()));               // el cerrojo se libera en el mismo commit
      }

      // CORREGIDO: también permite editar la nota de una sesión en curso
      function noteOnly() {
        return o().voided == false
          && changed().hasOnly(['note','rev','updated_at'])
          && strOk(n().note, o().method == 'manual' ? 5 : 0, 2000);
      }

      function voidIt() {                                 // irreversible; solo sesiones cerradas
        return o().end_time != null && o().voided == false
          && changed().hasOnly(['voided','void_reason','rev','updated_at'])
          && n().voided == true
          && strOk(n().void_reason, 10, 500);
      }

      allow delete: if false;

      match /revisions/{rid} {
        allow read: if isReader() || (isStudent() && get(sessPath(sid)).data.owner == uid());
        allow create: if isStudent()
          && get(sessPath(sid)).data.owner == uid()
          && rid == string(get(sessPath(sid)).data.rev)
          && request.resource.data.keys().hasOnly(['before','at'])
          && request.resource.data.before == get(sessPath(sid)).data   // copia exacta (probar en el emulador)
          && request.resource.data.at == request.time
          && getAfter(sessPath(sid)).data.rev == get(sessPath(sid)).data.rev + 1;
        allow update, delete: if false;
      }
    }

    match /live/{owner} {
      allow read: if isReader() || (isStudent() && owner == uid());
      allow create: if isStudent() && owner == uid()
        && request.resource.data.keys().hasOnly(['session_id'])
        && request.resource.data.session_id is string
        && !exists(sessPath(request.resource.data.session_id))                   // sesión nueva
        && getAfter(sessPath(request.resource.data.session_id)).data.owner == uid()
        && getAfter(sessPath(request.resource.data.session_id)).data.method == 'live'   // CORREGIDO
        && getAfter(sessPath(request.resource.data.session_id)).data.end_time == null;
      allow update: if false;       // un set() sobre un cerrojo existente se evalúa como update: impide una 2.ª sesión
      allow delete: if isStudent() && owner == uid()
        && getAfter(sessPath(resource.data.session_id)).data.end_time != null;
    }

    match /comments/{cid} {
      function c() { return request.resource.data; }
      allow read: if isReader() || (isStudent() && resource.data.session_owner == uid());
      allow create: if isSupervisor()
        && c().keys().hasAll(['session_id','session_owner','author_uid','text','created_at'])
        && c().keys().hasOnly(['session_id','session_owner','author_uid','text','created_at'])
        && c().author_uid == uid()
        && c().created_at == request.time
        && strOk(c().text, 1, 2000)
        && c().session_id is string
        && get(sessPath(c().session_id)).data.owner == c().session_owner;
      allow update, delete: if false;                     // append-only
    }

    match /meta/backup {
      allow read: if isAppUser();
      allow create, update: if isBackup()
        && request.resource.data.keys().hasOnly(['last_backup_at','docs'])
        && request.resource.data.last_backup_at == request.time
        && request.resource.data.docs is int;
      allow delete: if false;
    }
  }
}
```

**Lecturas get/exists por operación:** como mucho 3 en START y como mucho 7 en STOP, dentro del límite de 10 por operación y 20 por transacción.

**Tests obligatorios** con el emulador (`firebase emulators:exec "vitest run"`):
1. START correcto → permitido. Un segundo START → denegado.
2. START con `start_time` puesto por el cliente → denegado.
3. STOP sin borrar `live` → denegado. Borrar `live` sin cerrar la sesión → denegado.
4. STOP normal con `end_time` distinto de la hora del servidor → denegado. STOP ajustado con fin en el futuro, de más de 16 h o con motivo de menos de 10 caracteres → denegado.
5. Cualquier cambio de una sesión sin su revisión, o con un `before` falseado → denegado.
6. En una sesión cerrada: cambiar el inicio o el fin, deshacer la anulación o borrarla → denegado.
7. Entrada manual con fin en el futuro, más de 16 h, inicio anterior a `program_start`, más de 31 días de antigüedad o nota de menos de 5 caracteres → denegado.
8. La supervisora crea o modifica una sesión o un `live` → denegado.
9. Comentarios: la supervisora comenta → permitido. El student comenta → denegado. Un `session_owner` falso → denegado. Editar o borrar un comentario → denegado.
10. El student lista `sessions` sin `where(owner)` → denegado.
11. Cuenta de Auth sin `users/{uid}` → todo denegado. Cualquier escritura en `users` → denegada.
12. Cuenta `backup`: puede leer, cualquier escritura en `sessions` se deniega y escribir `meta/backup` con una hora puesta por el cliente también. Caso positivo: comprobar que la igualdad del mapa `before` funciona con timestamps.

### 4.B Políticas y permisos SQL (Plan B)

```sql
alter table public.settings         enable row level security;
alter table public.profiles         enable row level security;
alter table public.sessions         enable row level security;
alter table public.session_comments enable row level security;
alter table public.session_audit    enable row level security;
alter table public.ops_heartbeat    enable row level security;

create policy settings_select on public.settings for select to authenticated
  using ((select private.app_role()) is not null);
create policy profiles_select on public.profiles for select to authenticated
  using ((select private.app_role()) is not null);
create policy sessions_select on public.sessions for select to authenticated
  using (user_id = (select auth.uid()) or (select private.app_role()) = 'supervisor');
-- sessions no tiene políticas de insert/update/delete: solo escriben las funciones private.*
create policy comments_select on public.session_comments for select to authenticated
  using ((select private.app_role()) = 'supervisor'
         or exists (select 1 from public.sessions s
                     where s.id = session_comments.session_id and s.user_id = (select auth.uid())));
create policy comments_insert on public.session_comments for insert to authenticated
  with check (author_id = (select auth.uid())
              and (select private.app_role()) = 'supervisor'
              and exists (select 1 from public.sessions s where s.id = session_comments.session_id));
create policy audit_select on public.session_audit for select to authenticated
  using ((select private.app_role()) = 'supervisor'
         or exists (select 1 from public.sessions s
                     where s.id = session_audit.session_id and s.user_id = (select auth.uid())));
create policy heartbeat_select on public.ops_heartbeat for select to anon using (true);
create policy heartbeat_update on public.ops_heartbeat for update to anon using (true) with check (true);

-- Permisos mínimos
revoke all on all tables    in schema public  from anon, authenticated;
revoke all on all functions in schema public  from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
alter default privileges revoke execute on functions from public;
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;

grant select on public.settings, public.profiles, public.sessions, public.session_comments,
                public.session_audit, public.v_sessions, public.v_progress, public.v_weekly
  to authenticated;
grant insert (session_id, body) on public.session_comments to authenticated;  -- author_id y created_at no se pueden asignar

grant execute on function
  public.clock_in(text), public.clock_out(text), public.close_forgotten(timestamptz, text),
  public.add_manual(date, int, text), public.edit_note(bigint, text),
  public.void_session(bigint, text), public.server_now()
  to authenticated;
grant execute on function
  private.app_role(), private.require_student(), private.assert_daily_cap(uuid, date, int),
  private.clock_in(text), private.clock_out(text), private.close_forgotten(timestamptz, text),
  private.add_manual(date, int, text), private.edit_note(bigint, text), private.void_session(bigint, text)
  to authenticated;

-- CORREGIDO: el keep-alive usa la publishable key (anon), no la secret key
grant select, update (beat_at) on public.ops_heartbeat to anon;
grant execute on function public.heartbeat() to anon;

-- Prueba de roles (SQL Editor). Repetirla con cada UUID y cada operación prohibida.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<UUID_ESTUDIANTE>","role":"authenticated"}', true);
do $$ begin
  insert into public.session_comments (session_id, body) values (1, 'intento');
  raise exception 'FALLO: la estudiante ha podido comentar';
exception when insufficient_privilege then raise notice 'OK: comentario denegado';
end $$;
rollback;
```

**Operación del Plan B:**
- Hosting en Cloudflare Workers Static Assets (`[assets] directory="./dist"`, `not_found_handling="single-page-application"`) o en Vercel Hobby.
- Keep-alive: GitHub Actions en un repo **privado**, dos veces al día, con `POST /rest/v1/rpc/heartbeat` y la cabecera `apikey: sb_publishable_...`.
- Backup semanal con `supabase db dump` a través del *Session pooler* (IPv4), cifrado.
- Login: registros públicos desactivados y cuentas creadas con *Create new user* + *Auto Confirm*.

---

## 5. Mecánica de fichaje (Firebase)

**Principio:** el estado vive solo en Firestore; el navegador solo guarda el token de login. START y STOP usan `runTransaction`, que falla si no hay conexión, así que nunca queda un fichaje en cola que luego se registre con la hora de sincronización. Los botones se desactivan si `navigator.onLine` es falso y mientras la operación está pendiente.

**1. START.** Hora del servidor y una sola sesión abierta:
```ts
export async function start(uid: string) {
  if (!navigator.onLine) throw new Error('Sin conexión');
  await runTransaction(db, async (tx) => {
    const liveRef = doc(db, 'live', uid);
    if ((await tx.get(liveRef)).exists()) throw new Error('Ya hay una sesión en curso');
    const sRef = doc(collection(db, 'sessions'));
    tx.set(sRef, { owner: uid, method: 'live', start_time: serverTimestamp(), end_time: null,
      adjusted: false, adjust_reason: '', voided: false, void_reason: '', note: '', rev: 0,
      created_at: serverTimestamp(), updated_at: serverTimestamp() });
    tx.set(liveRef, { session_id: sRef.id });
  });
}
```
Por qué funciona:
- Las reglas exigen `start_time == request.time`, es decir, la hora del servidor.
- El cerrojo `live/{uid}` impide que haya dos sesiones abiertas: si ya existe, el `set` cuenta como *update* y se deniega. Da igual que haya doble clic, dos pestañas o dos dispositivos.

**2. STOP.** Normal o con fin ajustado. Todo va en una sola transacción: se guarda la revisión, se cierra la sesión y se libera el cerrojo.
```ts
export async function stop(uid: string, note: string, fix?: { at: Date; reason: string }) {
  if (!navigator.onLine) throw new Error('Sin conexión');
  await runTransaction(db, async (tx) => {
    const liveRef = doc(db, 'live', uid);
    const live = await tx.get(liveRef);
    if (!live.exists()) throw new Error('No hay sesión en curso');
    const sRef = doc(db, 'sessions', live.data().session_id);
    const cur = (await tx.get(sRef)).data() as SessionDoc;
    tx.set(doc(sRef, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() });
    tx.update(sRef, {
      end_time: fix ? Timestamp.fromDate(fix.at) : serverTimestamp(),
      adjusted: !!fix, adjust_reason: fix?.reason ?? '',
      note, rev: cur.rev + 1, updated_at: serverTimestamp(),
    });
    tx.delete(liveRef);
  });
}
```
- **Parada normal:** fin = hora del servidor.
- **Olvidé parar:** la UI avisa a partir de las 10 h. Pasadas las 16 h, el botón "Parar" se sustituye por "¿A qué hora terminaste?". El fin elegido debe estar entre el inicio y ahora, con un máximo de 16 h, y el motivo es obligatorio (al menos 10 caracteres). La hora se introduce en Madrid y se convierte con `fromZonedTime(..., 'Europe/Madrid')`.

**3. La sesión sobrevive al cierre del navegador.**
- Al abrir la app en cualquier dispositivo, `onSnapshot(doc(db,'live',uid))` devuelve el `session_id` y la app escucha esa sesión.
- El cronómetro muestra `Date.now() + skew − start_time`. El desfase (`skew`) se estima tras el START comparando el `start_time` del servidor con la hora local del clic. El cronómetro es solo visual.
- La supervisora ve en tiempo real, escuchando `live`, que hay una sesión "EN CURSO desde HH:MM", y puede comentarla porque su id no cambia.

**4. Entrada manual.** Fecha + duración, en hora de Madrid de forma explícita:
```ts
import { fromZonedTime } from 'date-fns-tz';
const start = fromZonedTime(`${fecha}T${hora ?? '09:00'}:00`, 'Europe/Madrid'); // 09:00 por defecto, marcado "aprox."
const end = new Date(start.getTime() + minutos * 60_000);
await setDoc(doc(collection(db, 'sessions')), { owner: uid, method: 'manual',
  start_time: Timestamp.fromDate(start), end_time: Timestamp.fromDate(end),
  adjusted: false, adjust_reason: '', voided: false, void_reason: '', note, rev: 0,
  created_at: serverTimestamp(), updated_at: serverTimestamp() });
```
- **Qué validan las reglas** (el cliente comprueba lo mismo antes de enviar): fin posterior al inicio, como mucho 16 h, fin no posterior a ahora, inicio no anterior a `program_start` ni a hace 31 días, y nota de al menos 5 caracteres.
- **Solapes y días de más de 10 h:** las reglas no pueden hacer consultas, así que no se bloquean. Se avisa antes de guardar y se marcan en la vista de la supervisora.
- **Horas inexistentes o repetidas por el cambio de hora** (29-03 y 25-10 entre las 02:00 y las 03:00): la hora por defecto, las 09:00, las evita.

**5. Correcciones visibles para la supervisora.**
- Una vez cerrada una sesión, sus horas **no se pueden cambiar**.
- La estudiante solo puede editar la nota o **anular** la sesión con motivo (irreversible). Para corregir horas: anular y crear una sesión manual nueva.
- Toda modificación usa la misma transacción con revisión:
```ts
export async function patchSession(sid: string, patch: { note?: string } | { voided: true; void_reason: string }) {
  if (!navigator.onLine) throw new Error('Sin conexión');
  await runTransaction(db, async (tx) => {
    const ref = doc(db, 'sessions', sid);
    const cur = (await tx.get(ref)).data() as SessionDoc;
    tx.set(doc(ref, 'revisions', String(cur.rev)), { before: cur, at: serverTimestamp() });
    tx.update(ref, { ...patch, rev: cur.rev + 1, updated_at: serverTimestamp() });
  });
}
```
- **Etiquetas en la vista de la supervisora:** `live` / `manual`, "fin ajustado: motivo", "anulada: motivo" (tachada), "nota editada (n)", "registrada X días después" (`created_at − end_time` > 48 h), "solapa con…" y "día > 10 h".
- **Historial:** al abrir el detalle de una sesión se ve su lista de `revisions`, con el estado anterior de cada cambio.
- **Controles:** la supervisora no tiene ningún control de edición; aunque lo intentara, las reglas lo rechazarían.

**6. Zona horaria.**
- Todo se guarda como `Timestamp` (UTC) y se muestra con `Intl.DateTimeFormat('es-ES', {timeZone: 'Europe/Madrid'})`.
- La duración es una resta entre dos instantes, así que es correcta aunque haya un cambio de hora (25-10-2026, 28-03-2027).
- Una sesión que cruza la medianoche cuenta en el día en que empezó.

**7. Exportación y backup.**
- **Exportar CSV/JSON** (ambos roles): fecha local, inicio, fin, minutos, método, ajuste y motivo, anulación y motivo, nota, número de comentarios y `created_at`. Usa la misma función `dur`, así que el total del informe coincide con la barra de progreso.
- **Backup automático:** un workflow semanal (lunes a las 03:17 UTC, y también lanzable a mano) en un repo **privado**:
  1. `node scripts/backup.mjs` inicia sesión con la cuenta `backup` usando secrets: API key de backup, email y contraseña.
  2. Vuelca `users`, `sessions` y sus `revisions`, `live` y `comments` a JSON.
  3. Escribe `meta/backup`.
  4. Cifra el fichero con `gpg --batch --pinentry-mode loopback --symmetric` (la frase de paso va en un secret).
  5. Lo sube como *artifact* con `retention-days: 90`.
- La app muestra la fecha del último backup y avisa si tiene más de 10 días.

---

## 6. Decisiones abiertas (confírmalas antes de montar el proyecto)

1. **¿Firebase o Supabase?** **Recomendado: Firebase Spark (§3.A).** Elige el Plan B (Supabase, §3.B/§4.B) solo si prefieres SQL y aceptas mantener un keep-alive, vigilar los correos de pausa y resetear tú la contraseña de la profesora.
2. **Límites de las entradas manuales.** **Recomendado:** como mucho 31 días de retraso, no antes de `program_start`, máximo 16 h por entrada, nota obligatoria y aviso a partir de 10 h al día. Conviene confirmarlo con la profesora, y también si quiere **validar** las horas manuales. Recomendado: no; basta con comentarios y etiquetas.
3. **Backup automático con una tercera cuenta técnica `backup` (solo lectura).** **Recomendado: sí.** La alternativa es exportar solo a mano cada mes, pero depende de que nadie se olvide.
4. **Cerrar los registros con el cambio a Identity Platform.** **Recomendado: sí**, si la consola lo permite en Spark **[P]**. Si no, las reglas ya dejan sin permisos a cualquier cuenta sin perfil.

---

## 7. Resumen de discrepancias y cómo se resolvieron

| Tema | Discrepancia | Resolución |
|---|---|---|
| Ganador | El juez 1 eligió la propuesta Firebase "Cero-Servidor" (8 frente a 5,5 de HoraFirme). El juez 2 eligió HoraFirme/Supabase (8 frente a 7,5). | Medias: Cero-Servidor 7,75; HoraFirme 6,75; Contrapropuesta Firebase 6,75. **Se parte de Cero-Servidor.** HoraFirme queda como Plan B, corregido. |
| Firebase o Supabase | Supabase ofrece más integridad declarativa (EXCLUDE, CHECK, auditoría). Firebase exige menos operación (sin pausa, sin SMTP, un solo proveedor). | Firebase, añadiendo lo más valioso de la integridad: horas inmutables, `revisions` append-only, motivos obligatorios, ventana de 31 días y límite inferior de fecha. Queda sin resolver en el servidor el bloqueo de solapes y del tope diario de las manuales: se sustituye por avisos y etiquetas. |
| Batch o transacción | Cero-Servidor usaba `writeBatch` en cola, con lo que un fichaje sin conexión recibía la hora de sincronización. | Se adopta `runTransaction` (de la Contrapropuesta) y se desactivan los botones sin conexión. |
| Hora de la entrada manual | `new Date()` dependía de la zona horaria del navegador. | `fromZonedTime(..., 'Europe/Madrid')` (date-fns-tz 3.2.0). |
| Sesiones manuales editables (Contrapropuesta) o inmutables (Cero-Servidor) | La Contrapropuesta permitía reescribir horas sin dejar rastro y "desborrar". | **Inmutables**: anular (irreversible, con motivo) y volver a crear. Toda edición deja una revisión. |
| Fallos en las reglas de Firebase | Sin límite inferior en las manuales; no se podía editar la nota de una sesión abierta; el cerrojo no comprobaba `method`; `progress()` no era TypeScript válido; la Contrapropuesta no exigía `end_time ≤ ahora`; el student no podía leer el perfil de la profesora. | Todos corregidos en §3.A y §4 (`manualEntry`, `noteOnly`, `live.create`, `progress`, `end < request.time`, `users` legible por los tres roles). |
| Desactivar el registro | Cero-Servidor decía "si aparece la opción", pero no existe sin Identity Platform. | Se documenta el cambio a Identity Platform **[P]**, además de la denegación por defecto en las reglas. |
| Backups | En las dos propuestas Firebase eran manuales. | Workflow semanal con la cuenta `backup` de solo lectura, indicador en la app y CSV mensual. La API key de backup es distinta de la web por la restricción por *referrer*. |
| Desnormalizar `supervisor_id` (Contrapropuesta; el juez 2 lo propuso injertar) | El juez 1 lo consideró piezas de más sin ventaja. | **No se adopta**: hay una sola supervisora y un solo student. Si hubiera más, se añadiría. |
| Borrar comentarios | Cero-Servidor permitía a la autora borrar los suyos. | Append-only en ambas variantes, por trazabilidad. Una errata se corrige con otro comentario. |
| Fallos en el SQL de HoraFirme | Sin RLS ni políticas en el DDL; `manual_minutes` NULL aceptado; tope diario que no se aplicaba a las live; `check_violation` sin capturar; minutos truncados; división entera; fecha `'2026-09-XX'` inválida; `date_trunc` sobre date; nota mínima incoherente en `edit_manual`; keep-alive con secret key; CSP inaplicable en un Worker que solo sirve ficheros. | Todos corregidos en §3.B/§4.B. `edit_manual` se elimina por inmutabilidad. El tope diario solo bloquea manuales, pero cuenta las live. En Firebase, la cabecera CSP iría en `firebase.json › hosting.headers` (opcional; comprobar en la consola del navegador que no bloquea el SDK). |
| Ventana de restauración de Supabase | La investigación 3 daba 90 días; la investigación 1, 1 año. | **1 año**, según la documentación actual **[V]**. Los 90 días están desfasados. |
| GitHub Actions a los 60 días | HoraFirme daba por hecho que los repos privados no se ven afectados. | Solo está documentado para repos públicos. Para privados queda **[NV]**; se mitiga con el indicador de último backup. |
| Cuotas de correo de Auth (150/5 al día) y export solo en Blaze | Solo las afirma la Contrapropuesta. | Se mantienen marcadas como no contrastadas en la investigación común. |