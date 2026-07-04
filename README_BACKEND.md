# HelpDesk_X · Pruebas manuales backend

Estas pruebas asumen backend en `http://localhost:5000`, PostgreSQL y Redis activos.

## 1. Login como asociado

```powershell
$base = "http://localhost:5000"
$ana = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType "application/json" -Body (@{
  username = "ana.lopez"
  password = "Asociado2026*"
} | ConvertTo-Json)
$anaToken = $ana.token
```

## 2. Crear ticket

```powershell
$ticketResponse = Invoke-RestMethod -Method Post "$base/api/tickets" -Headers @{ Authorization = "Bearer $anaToken" } -ContentType "application/json" -Body (@{
  categoria = "Software"
  etiqueta = "Error de acceso"
  descripcion = "No puedo ingresar al sistema contable."
  respuestas_contexto = @{
    scope = 2
    workaround = 3
    business = 2
  }
} | ConvertTo-Json -Depth 6)
$ticketId = $ticketResponse.ticket.id
$ticketResponse
```

## 2.1 Validar bloqueo por ticket activo o planificación conflictiva

Si el asociado intenta crear otro ticket mientras tiene uno en `Nuevo`, `Abierto`, `En Progreso`, `En Espera` o `Resuelto`, el backend debe responder `409`.

Un ticket `Planificado` no bloquea automáticamente, pero sí bloquea si:

- El nuevo ticket es de la misma categoría.
- La hora actual está dentro de la ventana de atención planificada: `fecha_planificada - 30 min` hasta `fecha_planificada + sla_objetivo_minutos` o 60 minutos si no hay SLA.

```powershell
try {
  Invoke-RestMethod -Method Post "$base/api/tickets" -Headers @{ Authorization = "Bearer $anaToken" } -ContentType "application/json" -Body (@{
    categoria = "Software"
    etiqueta = "Error de acceso"
    descripcion = "Intento crear un segundo ticket mientras el primero sigue activo."
    respuestas_contexto = @{
      scope = 1
      workaround = 1
      business = 1
    }
  } | ConvertTo-Json -Depth 6)
} catch {
  $_.Exception.Response.StatusCode.value__
  $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
  $reader.ReadToEnd()
}
```

Respuesta esperada:

```json
{
  "success": false,
  "error": "Ya tienes un ticket en progreso. Debes esperar a que sea cerrado antes de crear uno nuevo.",
  "code": "ACTIVE_TICKET_EXISTS",
  "activeTicket": {
    "id": 25,
    "estado": "En Progreso",
    "categoria": "Redes",
    "titulo": "Redes",
    "descripcion_breve": "..."
  }
}
```

Respuesta esperada si ya existe un ticket planificado de la misma categoría:

```json
{
  "success": false,
  "error": "Ya tienes un ticket de esta categoría planificado. No es necesario crear otro para el mismo problema.",
  "code": "PLANNED_SAME_CATEGORY_EXISTS",
  "activeTicket": {
    "id": 31,
    "estado": "Planificado",
    "categoria": "Redes",
    "titulo": "Redes",
    "fecha_planificada": "2026-06-26T15:00:00.000Z"
  }
}
```

Respuesta esperada si existe choque con la ventana horaria de una atención planificada:

```json
{
  "success": false,
  "error": "Ya tienes una atención planificada para este momento. Espera a que finalice o contacta a TI si es urgente.",
  "code": "PLANNED_TIME_CONFLICT",
  "activeTicket": {
    "id": 31,
    "estado": "Planificado",
    "categoria": "Redes",
    "titulo": "Redes",
    "fecha_planificada": "2026-06-26T15:00:00.000Z"
  }
}
```

## 3. Login como técnico

```powershell
$tech = Invoke-RestMethod -Method Post "$base/api/auth/login" -ContentType "application/json" -Body (@{
  username = "juan.perez"
  password = "Tech2026*"
} | ConvertTo-Json)
$techToken = $tech.token
```

## 4. Iniciar atención

```powershell
Invoke-RestMethod -Method Post "$base/api/technician/tickets/$ticketId/start" -Headers @{ Authorization = "Bearer $techToken" } -ContentType "application/json" -Body (@{} | ConvertTo-Json)
```

## 5. Resolver

```powershell
Invoke-RestMethod -Method Post "$base/api/technician/tickets/$ticketId/resolve" -Headers @{ Authorization = "Bearer $techToken" } -ContentType "application/json" -Body (@{
  evidence = "Se restableció el acceso y se validó login con el usuario."
  associateStars = 5
  associateComment = "Colaboró con la validación."
} | ConvertTo-Json)
```

## 6. Consultar historial

```powershell
Invoke-RestMethod -Method Get "$base/api/tickets/$ticketId/history" -Headers @{ Authorization = "Bearer $anaToken" }
```

## 7. Consultar notificaciones

```powershell
Invoke-RestMethod -Method Get "$base/api/notifications?username=ana.lopez" -Headers @{ Authorization = "Bearer $anaToken" }
```

> Nota: usuarios no admin ven sus notificaciones por sesión. El filtro `username` está pensado para admin.

## 8. Marcar notificación como leída

```powershell
$notifications = Invoke-RestMethod -Method Get "$base/api/notifications" -Headers @{ Authorization = "Bearer $anaToken" }
$notificationId = $notifications.notifications[0].id
Invoke-RestMethod -Method Post "$base/api/notifications/$notificationId/read" -Headers @{ Authorization = "Bearer $anaToken" }
```

## 9. Falla persiste

```powershell
Invoke-RestMethod -Method Post "$base/api/tickets/$ticketId/persist" -Headers @{ Authorization = "Bearer $anaToken" } -ContentType "application/json" -Body (@{
  comentario = "La falla persiste al intentar ingresar nuevamente."
} | ConvertTo-Json)
```

## 10. Consultar historial otra vez

```powershell
Invoke-RestMethod -Method Get "$base/api/tickets/$ticketId/history" -Headers @{ Authorization = "Bearer $anaToken" }
```

## Endpoints agregados en esta fase

- `GET /api/tickets/:id/history`
- `GET /api/notifications`
- `POST /api/notifications/:id/read`
- `POST /api/notifications/:id/seen`

## Tablas agregadas en esta fase

- `schema_migrations`
- `ticket_status_history`
- `notification_log`

## Validaciones fuertes y calificación bilateral

### Crear ticket

`POST /api/tickets`

```json
{
  "categoria": "Software",
  "etiqueta": "Error de acceso",
  "descripcion": "No puedo ingresar al sistema contable después del cambio de contraseña.",
  "respuestas_contexto": {
    "scope": 2,
    "workaround": 3,
    "business": 2
  }
}
```

Reglas aplicadas:

- `categoria` obligatoria y válida.
- `etiqueta` debe pertenecer a la categoría.
- `descripcion` obligatoria, con mínimo 25 caracteres reales después de `trim`.
- Las preguntas requeridas por la categoría son obligatorias porque se validan en el motor de prioridad.

### Resolver ticket como técnico

`POST /api/technician/tickets/:id/resolve`

```json
{
  "evidencia_resolucion": "Se restableció el acceso, se validó login y el usuario confirmó ingreso correcto.",
  "associate_stars": 5,
  "associate_comment": "El asociado respondió rápido y validó la solución."
}
```

Reglas aplicadas:

- Solo técnico asignado puede resolver.
- `evidencia_resolucion` mínima de 25 caracteres reales.
- `associateStars`/`associate_stars` obligatorio entre 1 y 5.
- `associateComment`/`associate_comment` obligatorio, sin mínimo de caracteres.
- Crea `ticket_ratings` con `rating_type = technician_to_associate`.
- El ticket queda `Resuelto` esperando validación del asociado.

### Confirmar solución y calificar técnico

`POST /api/tickets/:id/feedback`

```json
{
  "puntuacion": 5,
  "comentario_evidencia": "El técnico resolvió el problema y explicó la causa claramente."
}
```

Reglas aplicadas:

- Solo el asociado propietario puede calificar.
- `score`/`puntuacion` obligatorio entre 1 y 5.
- `comment`/`comentario_evidencia` obligatorio, sin mínimo de caracteres.
- Evita doble calificación `associate_to_technician` por ticket.
- Guarda en `ticket_ratings` y mantiene compatibilidad con `historial_calificaciones`.
- Cierra el ticket.

### La falla persiste

`POST /api/tickets/:id/persist`

```json
{
  "comentario": "La falla persiste porque el sistema vuelve a rechazar mis credenciales al reintentar."
}
```

Reglas aplicadas:

- Solo el asociado propietario puede reabrir.
- Comentario obligatorio mínimo 25 caracteres.
- Regresa el ticket a `En Progreso`.
- Notifica al técnico asignado.

### Consultar calificaciones admin

- `GET /api/admin/ratings`
- `GET /api/admin/ratings/technicians`
- `GET /api/admin/ratings/associates`
- `GET /api/admin/tickets/:id/ratings`

Respuesta:

```json
{
  "ratings": [
    {
      "ticket_id": 15,
      "ticket_number": 15,
      "category": "Software",
      "priority": "Alta",
      "associate_name": "Ana López",
      "technician_name": "Juan Pérez",
      "rating_type": "associate_to_technician",
      "stars": 5,
      "comment": "Resolución clara y rápida.",
      "created_at": "2026-06-25T18:30:00.000Z"
    }
  ]
}
```

### Detalle enriquecido de ticket

`GET /api/tickets/:id` ahora incluye:

- `ticket.descripcion_breve`
- `ticket.titulo_tecnico`
- `ticket.categoria`
- `ticket.prioridad`
- `ticket.tecnico`
- `ticket.asociado`
- `ratings`
- `legacyRatings`
- `pendingAssociateRating`
- `pendingTechnicianRating`
## Matriz real de asignación técnica

La matriz usada por el backend y por el módulo **Técnicos** es
`tecnico_categoria_config`. No se utiliza una tabla llamada
`matriz_tecnicos`.

Las reglas pueden guardarse con `PUT /api/admin/assignment-matrix/:categoryId`
o con `POST /api/admin/technician-assignment`. Al guardar una matriz se
reprocesan los tickets abiertos sin técnico de esa categoría.
