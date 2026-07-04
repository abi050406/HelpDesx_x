BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_reason VARCHAR(80);

CREATE INDEX IF NOT EXISTS idx_tickets_unassigned_category
  ON tickets(categoria_id,estado,asignacion_estado)
  WHERE tecnico_id IS NULL;

COMMIT;
