# Contexto

Soy estudiante de Ingeniería Electrónica de Telecomunicaciones haciendo unas prácticas curriculares de investigación (298 horas objetivo) dirigidas por mi profesora. Necesito una app para fichar mis horas de trabajo que **no sea local**: mi profesora debe poder entrar y ver el detalle de mis sesiones y dejar comentarios, sin depender de que yo le pase un archivo.

# Objetivo

Construir una app web con dos roles:
- **student** (yo): fichar en vivo (start/stop) y también añadir horas manualmente (fecha + duración), ver mi propio historial y el progreso hacia las 298 horas.
- **supervisor** (mi profesora): ver el detalle de todas mis sesiones (no editarlas) y añadir comentarios sobre ellas.

# Restricciones que no quiero perder

- Los datos viven en un backend remoto (no local storage/localStorage como única fuente de verdad): si cierro el navegador con una sesión fichada abierta, no se debe perder.
- Debe haber login diferenciado por rol (yo no debo poder editar como si fuera ella, ella no debe poder editar mis horas).
- Coste: quiero quedarme dentro de planes gratuitos, somos solo dos usuarios.
- Quiero poder desplegarlo yo mismo sin gestionar un servidor a mano.

# Punto de partida propuesto (no es obligatorio seguirlo)

Como idea inicial había pensado en Next.js + Supabase (Postgres + Auth + Row Level Security) + despliegue en Vercel, con un modelo de datos aproximado:

```
users:    id, email, role ('student' | 'supervisor'), name
sessions: id, user_id, start_time, end_time (nullable),
          duration_minutes, method ('live' | 'manual'),
          status ('en_curso' | 'cerrada'), note
comments: id, session_id, author_id, text, created_at
```

**Pero no quiero que te ates a esto.** Si ves una combinación de herramientas mejor para este caso concreto (por ejemplo, otro backend-as-a-service, otro framework, otra forma de modelar las sesiones o los permisos), quiero que la propongas tú, explicando en 2-3 frases por qué es mejor que la propuesta de arriba para este caso de dos usuarios y bajo mantenimiento.

# Cómo quiero que trabajes

1. Antes de escribir código, dime qué stack vas a usar y por qué (confirmando o cambiando la propuesta anterior), y un esquema de datos.
2. Espera mi confirmación antes de montar el proyecto.
3. Luego implementa: fichaje en vivo + entrada manual, dashboard de solo lectura con comentarios para el rol supervisor, y un indicador de progreso sobre las 298 horas.
4. Al final, dime qué pasos me faltan a mí (crear cuentas, variables de entorno, desplegar) para dejarlo funcionando de verdad.
