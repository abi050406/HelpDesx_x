BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_cerrado TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS fecha_planificada TIMESTAMPTZ;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS diagnostico_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE tickets ADD COLUMN IF NOT EXISTS revision_asignacion TEXT;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS max_active_tickets INTEGER NOT NULL DEFAULT 5;

DO $$
DECLARE target_column TEXT;
BEGIN
  FOREACH target_column IN ARRAY ARRAY['fecha_inicio','fecha_planificada','fecha_resuelto']
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns c
      WHERE table_schema='public' AND table_name='tickets'
        AND c.column_name=target_column AND data_type='timestamp without time zone'
    ) THEN
      EXECUTE format(
        'ALTER TABLE tickets ALTER COLUMN %I TYPE TIMESTAMPTZ USING %I AT TIME ZONE ''UTC''',
        target_column,target_column
      );
    END IF;
  END LOOP;
END $$;

UPDATE tickets SET estado = CASE
  WHEN lower(replace(estado, '_', ' ')) IN ('nuevo','abierto') THEN 'Abierto'
  WHEN lower(replace(estado, '_', ' ')) IN ('en progreso','en proceso') THEN 'En Progreso'
  WHEN lower(replace(estado, '_', ' ')) IN ('en espera','en espera global') THEN 'En Espera'
  WHEN lower(replace(estado, '_', ' ')) IN ('planificado','planificada') THEN 'Planificado'
  WHEN lower(estado)='resuelto' THEN 'Resuelto'
  WHEN lower(estado)='cerrado' THEN 'Cerrado'
  WHEN lower(estado)='rechazado' THEN 'Rechazado'
  ELSE 'Abierto' END;

ALTER TABLE tickets DROP CONSTRAINT IF EXISTS tickets_estado_valid;
ALTER TABLE tickets ADD CONSTRAINT tickets_estado_valid
  CHECK (estado IN ('Abierto','En Progreso','En Espera','Planificado','Resuelto','Cerrado','Rechazado'));

ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS actor_username VARCHAR(80);
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS actor_role VARCHAR(30);
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS action VARCHAR(80);
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80);
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS before_json JSONB;
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS after_json JSONB;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id BIGSERIAL PRIMARY KEY,
  scope VARCHAR(300) NOT NULL,
  idempotency_key VARCHAR(160) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status_code INTEGER NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(scope,idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tickets_state_technician ON tickets(estado,tecnico_id);
CREATE INDEX IF NOT EXISTS idx_users_active_technicians ON app_users(is_active,id) WHERE role='tecnico';
CREATE INDEX IF NOT EXISTS idx_tickets_owner_state ON tickets(usuario_id,estado);
CREATE INDEX IF NOT EXISTS idx_tickets_planned ON tickets(fecha_planificada) WHERE estado='Planificado';
CREATE INDEX IF NOT EXISTS idx_ticket_ratings_ticket_type ON ticket_ratings(ticket_id,rating_type);
CREATE INDEX IF NOT EXISTS idx_status_history_ticket_created ON ticket_status_history(ticket_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_created ON auditoria_sistema(actor_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_idempotency_created ON idempotency_keys(created_at);

COMMIT;
