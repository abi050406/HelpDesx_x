BEGIN;

CREATE TABLE IF NOT EXISTS chat_groups (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT,
  created_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_group_members (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  added_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
  role_in_group VARCHAR(30) NOT NULL DEFAULT 'member',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(group_id,user_id)
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id BIGSERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id) ON DELETE CASCADE,
  sender_id INTEGER NOT NULL REFERENCES app_users(id),
  message TEXT NOT NULL CHECK (length(trim(message)) BETWEEN 1 AND 2000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  edited_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_chat_groups_active_updated
  ON chat_groups(is_active,updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_members_user_active
  ON chat_group_members(user_id,is_active,group_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_group_active
  ON chat_group_members(group_id,is_active,user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_created
  ON chat_messages(group_id,created_at DESC,id DESC);

COMMIT;
