BEGIN;

CREATE TABLE IF NOT EXISTS conflictos_atencion (
  asociado_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  tecnico_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  motivo TEXT NOT NULL,
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (asociado_id, tecnico_id)
);

CREATE TABLE IF NOT EXISTS tecnico_categoria_config (
  tecnico_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  categoria_id INTEGER NOT NULL REFERENCES configuracion_categorias(id) ON DELETE CASCADE,
  excluido BOOLEAN NOT NULL DEFAULT FALSE,
  prioridad_skill SMALLINT NOT NULL DEFAULT 3 CHECK (prioridad_skill BETWEEN 1 AND 99),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tecnico_id, categoria_id)
);

CREATE TABLE IF NOT EXISTS historial_asignaciones (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  tecnico_id INTEGER REFERENCES app_users(id),
  asignado_por INTEGER REFERENCES app_users(id),
  tipo VARCHAR(30) NOT NULL CHECK (tipo IN ('Automática','Forzada','Bolsa de Espera','Reasignación')),
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS historial_presencia (
  id BIGSERIAL PRIMARY KEY,
  tecnico_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  estado VARCHAR(30) NOT NULL CHECK (estado IN ('Activo','Ocupado','En Break','Fuera de Servicio')),
  razon TEXT,
  inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fin TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  usuario_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  subscription JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS asignacion_estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente';
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS duracion_neta_segundos BIGINT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS evidencia_resolucion TEXT;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS rechazado_en TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS cerrado_en TIMESTAMPTZ;

INSERT INTO tecnico_categoria_config (tecnico_id, categoria_id, prioridad_skill)
SELECT u.id, c.id, 1
FROM app_users u CROSS JOIN configuracion_categorias c
WHERE u.role = 'tecnico'
ON CONFLICT (tecnico_id, categoria_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS idx_asignaciones_ticket ON historial_asignaciones(ticket_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_presencia_tecnico ON historial_presencia(tecnico_id, inicio DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_presencia_abierta ON historial_presencia(tecnico_id) WHERE fin IS NULL;
CREATE INDEX IF NOT EXISTS idx_tickets_asignacion ON tickets(asignacion_estado, categoria_id, t_apertura);

COMMIT;
