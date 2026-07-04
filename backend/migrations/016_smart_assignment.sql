BEGIN;

ALTER TABLE tickets ADD COLUMN IF NOT EXISTS assignment_status VARCHAR(40);

UPDATE tickets
SET assignment_status=CASE
  WHEN tecnico_id IS NOT NULL THEN 'assigned'
  WHEN asignacion_estado='Bolsa de Espera' THEN 'waiting_pool'
  ELSE 'pending'
END
WHERE assignment_status IS NULL;

ALTER TABLE tickets ALTER COLUMN assignment_status SET DEFAULT 'pending';

CREATE INDEX IF NOT EXISTS idx_tickets_assignment_status_category
  ON tickets(assignment_status,categoria_id,created_at)
  WHERE tecnico_id IS NULL;

COMMIT;
