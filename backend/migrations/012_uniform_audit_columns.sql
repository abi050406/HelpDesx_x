BEGIN;

ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS action VARCHAR(80);
ALTER TABLE auditoria_sistema ADD COLUMN IF NOT EXISTS entity_type VARCHAR(80);

UPDATE auditoria_sistema
SET action=COALESCE(action,accion),
    entity_type=COALESCE(entity_type,entidad)
WHERE action IS NULL OR entity_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_audit_action_entity_created
  ON auditoria_sistema(action,entity_type,entidad_id,created_at DESC);

COMMIT;
