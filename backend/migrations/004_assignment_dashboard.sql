BEGIN;

ALTER TABLE tecnico_categoria_config
  ADD COLUMN IF NOT EXISTS descripcion_responsabilidad TEXT;

CREATE INDEX IF NOT EXISTS idx_tecnico_categoria_prioridad
  ON tecnico_categoria_config(categoria_id, excluido, prioridad_skill);

COMMIT;
