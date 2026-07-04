BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE IF NOT EXISTS app_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(80) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(140) NOT NULL,
  role VARCHAR(30) NOT NULL,
  role_label VARCHAR(80) NOT NULL,
  department VARCHAR(80),
  avatar VARCHAR(12),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS exclusion_corporativa BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_role_check;
UPDATE app_users SET role = 'tecnico' WHERE role = 'tech';
UPDATE app_users SET role = 'asociado' WHERE role = 'associate';
ALTER TABLE app_users ADD CONSTRAINT app_users_role_check CHECK (role IN ('admin', 'tecnico', 'asociado'));

CREATE TABLE IF NOT EXISTS configuracion_categorias (
  id SERIAL PRIMARY KEY,
  nombre_categoria VARCHAR(80) UNIQUE NOT NULL,
  tiempo_sla_minutos INTEGER NOT NULL CHECK (tiempo_sla_minutos > 0),
  preguntas_contexto JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(preguntas_contexto) = 'array'),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO configuracion_categorias (nombre_categoria, tiempo_sla_minutos, preguntas_contexto)
VALUES
  ('Software', 60, '[{"id":"scope","label":"¿A cuántas personas afecta?","options":[{"label":"Solo a mí","score":0},{"label":"A un equipo","score":2},{"label":"A toda la empresa","score":4}]},{"id":"workaround","label":"¿Existe una alternativa temporal?","options":[{"label":"Sí","score":0},{"label":"Parcial","score":1},{"label":"No","score":3}]},{"id":"business","label":"¿Detiene un proceso crítico?","options":[{"label":"No","score":0},{"label":"Lo ralentiza","score":2},{"label":"Lo detiene","score":4}]}]'::jsonb),
  ('Hardware', 120, '[{"id":"scope","label":"¿A cuántos puestos afecta?","options":[{"label":"Un puesto","score":0},{"label":"Varios puestos","score":2},{"label":"Área completa","score":4}]},{"id":"replacement","label":"¿Hay reemplazo disponible?","options":[{"label":"Sí","score":0},{"label":"Limitado","score":1},{"label":"No","score":3}]},{"id":"safety","label":"¿Existe riesgo físico o eléctrico?","options":[{"label":"No","score":0},{"label":"Posible","score":2},{"label":"Sí","score":5}]}]'::jsonb),
  ('Redes', 45, '[{"id":"scope","label":"¿Qué alcance tiene la interrupción?","options":[{"label":"Un dispositivo","score":0},{"label":"Un área","score":3},{"label":"Toda la sede","score":5}]},{"id":"connectivity","label":"¿La conexión está interrumpida?","options":[{"label":"No","score":0},{"label":"Intermitente","score":2},{"label":"Sí","score":4}]},{"id":"business","label":"¿Afecta servicios críticos?","options":[{"label":"No","score":0},{"label":"Parcialmente","score":2},{"label":"Sí","score":4}]}]'::jsonb)
ON CONFLICT (nombre_categoria) DO UPDATE SET
  tiempo_sla_minutos = EXCLUDED.tiempo_sla_minutos,
  preguntas_contexto = EXCLUDED.preguntas_contexto,
  updated_at = NOW();

CREATE TABLE IF NOT EXISTS etiquetas_categoria (
  id SERIAL PRIMARY KEY,
  categoria_id INTEGER NOT NULL REFERENCES configuracion_categorias(id) ON DELETE CASCADE,
  nombre_etiqueta VARCHAR(120) NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (categoria_id, nombre_etiqueta)
);

INSERT INTO etiquetas_categoria (categoria_id, nombre_etiqueta)
SELECT c.id, t.nombre
FROM configuracion_categorias c
CROSS JOIN LATERAL (
  SELECT jsonb_array_elements_text(
    CASE c.nombre_categoria
      WHEN 'Software' THEN '["Aplicación caída","Error de acceso","Instalación","Rendimiento"]'::jsonb
      WHEN 'Hardware' THEN '["Equipo no enciende","Impresora","Periférico","Daño físico"]'::jsonb
      WHEN 'Redes' THEN '["Sin Internet","VPN caída","Wi-Fi","Servidor inaccesible"]'::jsonb
      ELSE '[]'::jsonb
    END
  ) AS nombre
) t
ON CONFLICT (categoria_id, nombre_etiqueta) DO NOTHING;

CREATE TABLE IF NOT EXISTS tickets (
  id SERIAL PRIMARY KEY,
  titulo VARCHAR(120) NOT NULL,
  descripcion TEXT,
  usuario_id INTEGER,
  estado VARCHAR(50) DEFAULT 'Nuevo',
  prioridad VARCHAR(30) NOT NULL DEFAULT 'Media',
  categoria VARCHAR(80) NOT NULL DEFAULT 'Software',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS titulo_tecnico VARCHAR(220);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tecnico_id INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS etiqueta VARCHAR(120);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_inicio TIMESTAMP;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_resuelto TIMESTAMP;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_apertura TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_captura TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS t_resolucion TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS motivo_rechazo_tecnico TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS motivo_cierre_admin TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS categoria_id INTEGER REFERENCES configuracion_categorias(id);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS etiqueta_id INTEGER REFERENCES etiquetas_categoria(id);
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_usuario_id_fkey;
ALTER TABLE tickets ADD CONSTRAINT tickets_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES app_users(id) NOT VALID;
ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_tecnico_id_fkey;
ALTER TABLE tickets ADD CONSTRAINT tickets_tecnico_id_fkey FOREIGN KEY (tecnico_id) REFERENCES app_users(id) NOT VALID;

UPDATE tickets SET
  t_captura = COALESCE(t_captura, fecha_inicio),
  t_resolucion = COALESCE(t_resolucion, fecha_resuelto),
  categoria_id = COALESCE(categoria_id, (SELECT id FROM configuracion_categorias c WHERE c.nombre_categoria = tickets.categoria)),
  etiqueta_id = COALESCE(etiqueta_id, (SELECT id FROM etiquetas_categoria e WHERE e.categoria_id = (SELECT id FROM configuracion_categorias c WHERE c.nombre_categoria = tickets.categoria) AND e.nombre_etiqueta = tickets.etiqueta));

ALTER TABLE tickets VALIDATE CONSTRAINT tickets_usuario_id_fkey;
ALTER TABLE tickets VALIDATE CONSTRAINT tickets_tecnico_id_fkey;

CREATE TABLE IF NOT EXISTS historial_calificaciones (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tecnico_id INTEGER NOT NULL REFERENCES app_users(id),
  asociado_id INTEGER NOT NULL REFERENCES app_users(id),
  puntuacion SMALLINT NOT NULL CHECK (puntuacion BETWEEN 1 AND 5),
  comentario_evidencia TEXT NOT NULL CHECK (length(trim(comentario_evidencia)) > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ticket_id, asociado_id)
);

CREATE TABLE IF NOT EXISTS historial_pausas (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tipo_pausa VARCHAR(30) NOT NULL CHECK (tipo_pausa IN ('En Espera', 'Planificada')),
  t_pausa_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  t_pausa_fin TIMESTAMPTZ,
  created_by INTEGER REFERENCES app_users(id),
  CHECK (t_pausa_fin IS NULL OR t_pausa_fin >= t_pausa_inicio)
);

CREATE TABLE IF NOT EXISTS wiki_ti (
  id BIGSERIAL PRIMARY KEY,
  titulo VARCHAR(220) NOT NULL,
  contenido_solucion TEXT NOT NULL,
  caso_especial_id INTEGER REFERENCES tickets(id) ON DELETE SET NULL,
  vector_indexacion TSVECTOR GENERATED ALWAYS AS (
    to_tsvector('spanish', coalesce(titulo, '') || ' ' || coalesce(contenido_solucion, ''))
  ) STORED,
  created_by INTEGER REFERENCES app_users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mensajes_internos (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  emisor_id INTEGER NOT NULL REFERENCES app_users(id),
  mensaje TEXT NOT NULL CHECK (length(trim(mensaje)) > 0),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tipo_mensaje VARCHAR(30) NOT NULL CHECK (tipo_mensaje IN ('Nota Técnica', 'Actualización', 'Escalamiento', 'General'))
);

CREATE INDEX IF NOT EXISTS idx_calificaciones_tecnico ON historial_calificaciones(tecnico_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_calificaciones_asociado ON historial_calificaciones(asociado_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pausas_ticket ON historial_pausas(ticket_id, t_pausa_inicio);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pausa_abierta_ticket ON historial_pausas(ticket_id) WHERE t_pausa_fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_wiki_vector ON wiki_ti USING GIN(vector_indexacion);
CREATE INDEX IF NOT EXISTS idx_wiki_titulo_trgm ON wiki_ti USING GIN(titulo gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_mensajes_ticket ON mensajes_internos(ticket_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_etiquetas_categoria ON etiquetas_categoria(categoria_id, activo);

COMMIT;
