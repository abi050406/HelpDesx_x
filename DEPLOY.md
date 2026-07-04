# Guía de despliegue — HelpDesk_X en Render (entrega académica)

Este proyecto ya está listo para desplegarse: se corrigieron las URLs del
backend que estaban escritas a mano (`http://localhost:5000`) en el frontend,
ahora usan la variable de entorno `REACT_APP_API_URL`. También se agregó
`render.yaml`, un Blueprint que crea automáticamente los 4 recursos que
necesitas en Render: base de datos Postgres, Redis (Key Value), el backend y
el frontend.

## 0. Qué vas a usar (todo en el plan gratuito de Render)

| Recurso | Tipo en Render | Notas |
|---|---|---|
| `nextgen-helpdesk-db` | PostgreSQL Free | 1 GB, se borra a los 30 días + 14 de gracia. Para entrega académica está perfecto. |
| `nextgen-helpdesk-redis` | Key Value Free | Redis-compatible, 25 MB. |
| `nextgen-helpdesk-backend` | Web Service Free | Node/Express + Socket.io. Se "duerme" tras 15 min sin uso (tarda ~30-60s en despertar). |
| `nextgen-helpdesk-frontend` | Static Site | React compilado, gratis y sin sleep. |

Las migraciones SQL (17 archivos en `backend/migrations`) se ejecutan solas
al arrancar el backend por primera vez, así que **no necesitas** importar el
`.sql` dump manualmente en la base nueva.

## 1. Sube el código a GitHub

Desde la carpeta del proyecto (en tu computadora):

```bash
git init          # si no lo has hecho
git add .
git commit -m "Preparar despliegue en Render"
```

Crea un repositorio público nuevo en GitHub (por ejemplo
`nextgen-helpdesk`) y luego:

```bash
git branch -M main
git remote add origin https://github.com/TU_USUARIO/nextgen-helpdesk.git
git push -u origin main
```

> Importante: `node_modules/`, `.env` y `frontend/build/` ya están en
> `.gitignore`, así que no se subirán (está bien, Render los genera solo).

## 2. Despliega con el Blueprint (1 clic para los 4 recursos)

1. Entra a https://dashboard.render.com
2. Click en **New** → **Blueprint**
3. Conecta tu cuenta de GitHub y selecciona el repo `nextgen-helpdesk`
4. Render detecta el archivo `render.yaml` en la raíz y te muestra los 4
   recursos que va a crear. Dale **Apply/Deploy Blueprint**.
5. Cuando te pida valores para las variables marcadas `sync: false`:
   - `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: cópialas de tu archivo
     `.env` local (o genera unas nuevas ejecutando
     `npm run vapid:generate` dentro de `backend/`).
   - `REACT_APP_API_URL` (del frontend): déjala vacía por ahora, la
     completas en el paso 4.

## 3. Espera a que el backend termine de desplegar

En el dashboard, entra al servicio `nextgen-helpdesk-backend` y espera a
que el log diga algo como:

```
🔥 Servidor activo en: http://localhost:XXXX
PostgreSQL y Redis inicializados correctamente.
```

Copia la URL pública que Render le asignó, arriba del todo de la página del
servicio (algo como `https://nextgen-helpdesk-backend.onrender.com`).

## 4. Conecta el frontend con esa URL

1. Ve al servicio `nextgen-helpdesk-frontend` → **Environment**
2. Edita `REACT_APP_API_URL` y pégale la URL del backend (sin `/` al final)
3. Guarda y dispara un **Manual Deploy → Deploy latest commit** para ese
   servicio (Create React App incrusta la variable en el build, así que
   necesita recompilar).

## 5. Prueba

Abre la URL del sitio estático (`nextgen-helpdesk-frontend.onrender.com`).
El login, tickets, chat en tiempo real (Socket.io) y notificaciones deberían
funcionar contra el backend en Render.

Si necesitas usuarios de prueba, revisa `README_BACKEND.md`: incluye los
logins de ejemplo (`ana.lopez` / `juan.perez`) que puedes usar tal cual si
esos usuarios ya existen en tus migraciones/seed, o crear los tuyos desde el
panel admin.

## Notas y limitaciones a tener en cuenta (por ser plan gratuito)

- El backend "duerme" tras 15 minutos sin tráfico. La primera petición
  después de eso tarda 30-60 segundos en responder — es normal, no es un
  error tuyo. Menciónalo si el profesor prueba la app en frío.
- La base de datos Postgres gratuita se elimina automáticamente a los 30
  días (con 14 días de gracia). Si tu entrega es después de esa fecha,
  tendrás que recrear la base (las migraciones se vuelven a correr solas).
- Redis gratuito no persiste datos si el servicio se reinicia; en este
  proyecto solo se usa para presencia de técnicos y sesiones rápidas, no
  para datos críticos, así que no afecta la funcionalidad principal.
- CORS en el backend está abierto (`cors()` sin restricciones) y Socket.io
  también acepta cualquier origen — correcto para esta entrega, pero no lo
  dejarías así en un proyecto real.
