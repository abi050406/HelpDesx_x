BEGIN;

CREATE TABLE IF NOT EXISTS auditoria_sistema (
  id BIGSERIAL PRIMARY KEY,
  actor_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  accion VARCHAR(80) NOT NULL,
  entidad VARCHAR(80) NOT NULL,
  entidad_id BIGINT,
  detalle JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE wiki_ti ADD COLUMN IF NOT EXISTS categoria VARCHAR(80);
ALTER TABLE wiki_ti ADD COLUMN IF NOT EXISTS etiquetas TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE wiki_ti ADD COLUMN IF NOT EXISTS activo BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_auditoria_sistema_created ON auditoria_sistema(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auditoria_sistema_entidad ON auditoria_sistema(entidad, entidad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wiki_activo_categoria ON wiki_ti(activo, categoria);

COMMIT;
