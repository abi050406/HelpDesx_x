-- Esta migración consolida columnas y tablas que el código del backend
-- creaba "al vuelo" (la primera vez que se llamaba a una ruta específica),
-- en vez de estar declaradas en migraciones. Eso causaba errores como
-- "column tecnico_nombre of relation tickets does not exist" cuando una
-- ruta se usaba antes que otra en una base de datos nueva (por ejemplo,
-- crear/asignar un ticket como admin antes de que algún técnico usara su
-- panel). Todas las sentencias son idempotentes (IF NOT EXISTS), así que
-- no rompen nada si la columna ya existe.

BEGIN;

-- Columnas de tickets usadas por el flujo de asignación/trabajo de técnicos
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS tecnico_nombre VARCHAR(140);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS solicitante_nombre VARCHAR(140);
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS puntaje_prioridad INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS respuestas_contexto JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS sla_objetivo_minutos INTEGER;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS diagnostico_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_cerrado TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_espera TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_planificada TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_tickets_estado ON tickets(estado);
CREATE INDEX IF NOT EXISTS idx_tickets_prioridad ON tickets(prioridad);
CREATE INDEX IF NOT EXISTS idx_tickets_tecnico_id ON tickets(tecnico_id);
CREATE INDEX IF NOT EXISTS idx_tickets_usuario_id ON tickets(usuario_id);
CREATE INDEX IF NOT EXISTS idx_tickets_categoria_prioridad ON tickets(categoria, prioridad);

-- Historial de estados (por si la base es nueva y aún no existe)
CREATE TABLE IF NOT EXISTS ticket_status_history (
  id SERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  from_status VARCHAR(50),
  to_status VARCHAR(50) NOT NULL,
  actor_id INTEGER NULL,
  actor_name VARCHAR(150) NULL,
  actor_role VARCHAR(50) NULL,
  reason TEXT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_ticket_id ON ticket_status_history(ticket_id);
CREATE INDEX IF NOT EXISTS idx_ticket_status_history_created_at ON ticket_status_history(created_at DESC);

-- Historial de pausas de técnicos (usado por el flujo de espera/planificación)
CREATE TABLE IF NOT EXISTS historial_pausas (
  id BIGSERIAL PRIMARY KEY,
  ticket_id INTEGER NOT NULL,
  tipo_pausa VARCHAR(30) NOT NULL,
  t_pausa_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  t_pausa_fin TIMESTAMPTZ,
  created_by INTEGER,
  CHECK (t_pausa_fin IS NULL OR t_pausa_fin >= t_pausa_inicio)
);
CREATE INDEX IF NOT EXISTS idx_pausas_ticket ON historial_pausas(ticket_id, t_pausa_inicio);

COMMIT;
