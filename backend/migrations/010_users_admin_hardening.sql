BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL;

CREATE TABLE IF NOT EXISTS departments (
  id SERIAL PRIMARY KEY,
  code VARCHAR(30) UNIQUE NOT NULL,
  name VARCHAR(120) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO departments(code,name,sort_order)
VALUES
  ('TI','Tecnología de Información',1),
  ('MKT','Marketing',2),
  ('VA','Virtual Assistants',3),
  ('ISA','Inside Sales',4),
  ('Operaciones','Operaciones',5),
  ('Contabilidad','Contabilidad',6)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,
  sort_order=EXCLUDED.sort_order;

UPDATE app_users
SET must_change_password=FALSE
WHERE created_at < NOW() AND must_change_password=TRUE;

CREATE INDEX IF NOT EXISTS idx_app_users_active_role
  ON app_users(is_active,role);
CREATE INDEX IF NOT EXISTS idx_app_users_department
  ON app_users(department);
CREATE INDEX IF NOT EXISTS idx_app_users_normalized_full_name
  ON app_users((regexp_replace(lower(trim(full_name)), '\s+', ' ', 'g')))
  WHERE is_active=TRUE;

COMMIT;
