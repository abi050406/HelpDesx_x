BEGIN;

ALTER TABLE app_users
  ADD COLUMN IF NOT EXISTS max_active_tickets INTEGER NOT NULL DEFAULT 5;

CREATE INDEX IF NOT EXISTS idx_users_active_technicians
  ON app_users(is_active,id) WHERE role='tecnico';

COMMIT;
